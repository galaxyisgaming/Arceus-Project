import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getReactionRoleKey } from '../utils/database/keys.js';
import { getAllReactionRoleMessages, getReactionRoleMessage, hasDangerousPermissions } from './reactionRoleService.js';
import { logger } from '../utils/logger.js';
import { logEvent, EVENT_TYPES } from './loggingService.js';
import { assertOnboardingMemberApproved, assertOnboardingRoleAllowed } from './onboardingService.js';
import { Mutex } from '../utils/mutex.js';

export const MAX_REACTION_ROLES = 20;
const EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟',
    '🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
export const REACTION_PANEL_FOOTER = 'React to receive a role. Remove your reaction to remove the role.';

function emojiKey(emoji) {
    return /^(?:<a?:[^:]+:|[^:]+:)(\d+)>?$/.exec(emoji)?.[1] || emoji;
}

export async function normalizeReactionEmoji(guild, input) {
    const value = String(input || '').trim();
    const customId = /^(?:<a?:\w+:(\d{17,20})>|(\d{17,20}))$/.exec(value);
    if (customId) {
        const emoji = await guild.emojis.fetch(customId[1] || customId[2]);
        if (!emoji || emoji.available === false) throw new Error('Choose an available custom emoji from this server.');
        return emoji.id;
    }
    if (/^\p{RGI_Emoji}$/v.test(value)) return value;
    if (/^\p{RGI_Emoji}$/v.test(`${value}\uFE0F`)) return `${value}\uFE0F`;
    throw new Error('Enter one Unicode emoji or a custom emoji from this server, such as <:name:emoji_id>.');
}

function roleForEmoji(mappings, emoji) {
    const key = emojiKey(emoji).replace(/\uFE0F/g, '');
    return Object.entries(mappings || {}).find(([candidate]) =>
        emojiKey(candidate).replace(/\uFE0F/g, '') === key)?.[1];
}

export function reactionMappings(panel) {
    const roles = Array.isArray(panel.roles) ? panel.roles : Object.values(panel.roles || {});
    if (!roles.length || roles.length > MAX_REACTION_ROLES || new Set(roles).size !== roles.length) {
        throw new Error(`Emoji reaction panels require 1-${MAX_REACTION_ROLES} distinct roles. Split larger panels using /reactroles setup.`);
    }
    const previous = Object.fromEntries(Object.entries(panel.emojiRoles ||
        (Array.isArray(panel.roles) ? {} : panel.roles)).map(([emoji, role]) => [emojiKey(emoji), role]));
    const keys = Object.keys(previous).map(emoji => emoji.replace(/\uFE0F/g, ''));
    if (new Set(keys).size !== keys.length) throw new Error('Each role in a panel must use a different emoji.');
    const mappings = {};
    for (const [emoji, role] of Object.entries(previous)) {
        if (roles.includes(role) && !Object.values(mappings).includes(role)) mappings[emoji] = role;
    }
    for (const role of roles) {
        if (Object.values(mappings).includes(role)) continue;
        const emoji = EMOJIS.find(candidate => !roleForEmoji(mappings, candidate) && !roleForEmoji(previous, candidate));
        // A removed role's old reaction must be cleared before that emoji can be reused.
        const reusable = emoji || EMOJIS.find(candidate => !roleForEmoji(mappings, candidate));
        if (!reusable) throw new Error('No unused panel reaction emoji is available.');
        mappings[reusable] = role;
    }
    return mappings;
}

export function reactionPanelEmbed(embed, panel) {
    const mappings = reactionMappings(panel);
    const updated = EmbedBuilder.from(embed).toJSON();
    const fields = (updated.fields || []).filter(field => !/^Available Roles(?: \(continued \d+\))?$/.test(field.name));
    const legends = [''];
    for (const [emoji, role] of Object.entries(mappings)) {
        const line = `${/^\d+$/.test(emoji) ? `<:role:${emoji}>` : emoji} — <@&${role}>`;
        const index = legends.length - 1;
        if (legends[index].length + line.length + 1 > 1024) legends.push(line);
        else legends[index] += `${legends[index] ? '\n' : ''}${line}`;
    }
    fields.push(...legends.map((value, index) => ({
        name: index ? `Available Roles (continued ${index + 1})` : 'Available Roles', value, inline: false,
    })));
    // The global embed setters strip emoji and ordinary footers; this legend must retain both.
    return new EmbedBuilder({ ...updated, fields, footer: { text: REACTION_PANEL_FOOTER } });
}

export async function syncReactionPanel(client, message, panel, emojiRoles = panel.emojiRoles) {
    if (message.author.id !== client.user.id) throw new Error('Reaction role panel is not owned by this bot.');
    const me = message.guild.members.me || await message.guild.members.fetchMe();
    const permissions = message.channel.permissionsFor(me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions])) {
        throw new Error('Reaction role panels require View Channel, Read Message History and Add Reactions.');
    }
    const mappings = reactionMappings({ ...panel, emojiRoles });
    const previous = Object.fromEntries(Object.entries(panel.emojiRoles || {}).map(([emoji, role]) => [emojiKey(emoji), role]));
    const retired = [];
    for (const reaction of message.reactions.cache.values()) {
        const key = reaction.emoji.id || reaction.emoji.name;
        const nextRole = roleForEmoji(mappings, key);
        const previousRole = roleForEmoji(previous, key);
        if ((previousRole && previousRole !== nextRole) || (reaction.me && !nextRole)) {
            if (reaction.count > (reaction.me ? 1 : 0)) {
                if (!permissions.has(PermissionFlagsBits.ManageMessages)) {
                    throw new Error('Manage Messages is required to clear reactions for a removed role. Grant it and retry /reactroles dashboard.');
                }
            }
            retired.push(reaction);
        }
    }
    const currentEmbed = message.embeds[0];
    if (!currentEmbed) throw new Error('Reaction role panel has no embed.');
    // Save first so retiring reactions cannot revoke members' existing roles.
    const next = { ...panel, roles: [...new Set(Object.values(mappings))], emojiRoles: mappings, mode: 'reactions' };
    const embed = reactionPanelEmbed(currentEmbed, next);
    embed.toJSON();
    const saved = await client.db.set(getReactionRoleKey(panel.guildId, panel.messageId), next);
    if (!saved) throw new Error('Failed to save reaction role emoji mappings. The panel was not converted.');
    Object.assign(panel, next);
    for (const reaction of retired) {
        if (reaction.count > (reaction.me ? 1 : 0)) await reaction.remove();
        else await reaction.users.remove(client.user.id);
    }
    for (const emoji of Object.keys(mappings)) await message.react(emoji);
    await message.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } });
}

export async function setReactionRoleEmoji(client, guild, messageId, roleId, input) {
    return Mutex.runExclusive(`reaction-panel:${guild.id}:${messageId}`, async () => {
        const panel = await getReactionRoleMessage(client, guild.id, messageId);
        if (!panel) throw new Error('Reaction role panel not found. Choose a saved panel.');
        const mappings = reactionMappings(panel);
        if (!Object.values(mappings).includes(roleId)) throw new Error('That role is not on this panel.');
        const emoji = await normalizeReactionEmoji(guild, input);
        const duplicateRole = roleForEmoji(mappings, emoji);
        if (duplicateRole && duplicateRole !== roleId) throw new Error('That emoji is already assigned to another role on this panel.');
        const updated = Object.fromEntries(Object.entries(mappings).filter(([, id]) => id !== roleId));
        updated[emoji] = roleId;
        const channel = await guild.channels.fetch(panel.channelId);
        const message = await channel.messages.fetch(panel.messageId);
        await syncReactionPanel(client, message, panel, updated);
        return panel;
    });
}

export async function migrateReactionPanels(client) {
    for (const guild of client.guilds.cache.values()) {
        let panels;
        try {
            panels = await getAllReactionRoleMessages(client, guild.id);
        } catch (error) {
            logger.error(`Cannot load reaction role panels for guild ${guild.id}:`, error);
            continue;
        }
        for (const panel of panels) {
            try {
                const channel = await guild.channels.fetch(panel.channelId);
                const message = await channel.messages.fetch(panel.messageId);
                await syncReactionPanel(client, message, panel);
                logger.info(`Reaction role panel ${panel.messageId} ready with emoji reactions.`);
            } catch (error) {
                logger.error(`Reaction role migration failed for ${panel.messageId}; use /reactroles dashboard to repair:`, error);
            }
        }
    }
}

const pending = new Map();
async function applyReaction(reaction, user, added) {
    const client = reaction.client || reaction.message.client;
    if (user.bot || user.id === client.user.id || !reaction.message.guildId) return;
    const message = reaction.message;
    const panel = await getReactionRoleMessage(client, message.guildId, message.id);
    if (!panel || panel.mode !== 'reactions' || panel.channelId !== message.channelId) return;
    const emoji = reaction.emoji.id || reaction.emoji.name;
    const roleId = roleForEmoji(panel.emojiRoles, emoji);
    if (!roleId || !panel.roles.includes(roleId)) return;
    if (user.partial) user = await user.fetch();
    if (user.bot) return;
    const guild = message.guild || client.guilds.cache.get(message.guildId) || await client.guilds.fetch(message.guildId);
    const role = await guild.roles.fetch(roleId, { force: true });
    const me = await guild.members.fetchMe({ force: true });
    if (!role || role.managed || role.id === guild.id || hasDangerousPermissions(role) ||
        !me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
        throw new Error(`Cannot ${added ? 'assign' : 'remove'} protected or unmanageable reaction role ${roleId}.`);
    }
    const member = await guild.members.fetch({ user: user.id, force: true });
    await assertOnboardingRoleAllowed(client, guild.id, roleId);
    if (added) await assertOnboardingMemberApproved(client, member);
    let changed = false;
    if (added && !member.roles.cache.has(roleId)) {
        await member.roles.add(role, 'Emoji reaction role');
        changed = true;
    } else if (!added && member.roles.cache.has(roleId)) {
        await member.roles.remove(role, 'Emoji reaction role removed');
        changed = true;
    }
    if (changed) {
        logger.info(`Reaction role ${roleId} ${added ? 'added to' : 'removed from'} ${user.id} in ${message.guildId}.`);
        try {
            await logEvent({
                client,
                guildId: message.guildId,
                eventType: EVENT_TYPES.REACTION_ROLE_UPDATE,
                data: {
                    description: `Emoji reaction role ${added ? 'added' : 'removed'} for ${user.tag || user.id}`,
                    userId: user.id,
                    channelId: message.channelId,
                    fields: [{ name: added ? 'Role Added' : 'Role Removed', value: `<@&${roleId}>`, inline: false }],
                },
            });
        } catch (error) {
            logger.warn('Failed to log reaction role update:', error);
        }
    }
}

export async function handleRoleReaction(reaction, user, added) {
    const key = `${reaction.message.guildId}:${user.id}`;
    const previous = pending.get(key) || Promise.resolve();
    const work = previous.then(() => applyReaction(reaction, user, added));
    const settled = work.catch(error => {
        logger.error(`Reaction role ${added ? 'assignment' : 'removal'} failed on ${reaction.message.id} for ${user.id}:`, error);
    });
    pending.set(key, settled);
    await settled;
    if (pending.get(key) === settled) pending.delete(key);
}
