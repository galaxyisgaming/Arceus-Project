import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, EmbedBuilder, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { reactionMappings, reactionPanelEmbed, syncReactionPanel, migrateReactionPanels,
    handleRoleReaction, REACTION_PANEL_FOOTER } from '../src/services/reactionRolePanels.js';
import { reconcileReactionRoleMessages } from '../src/services/reactionRoleService.js';
import { getReactionRolePanelStatus } from '../src/utils/panelStatus.js';
import addEvent from '../src/events/messageReactionAdd.js';
import removeEvent from '../src/events/messageReactionRemove.js';
import { logger } from '../src/utils/logger.js';
import reactroles from '../src/commands/Reaction_roles/reactroles.js';
import { handleReactionRolesSelectMenu } from '../src/handlers/interactionHandlers/reactionRolesSelectMenu.js';

logger.silent = true;
const guildId = '1564658925591204011';
const channelId = '1564658925591204012';
const messageId = '1564658925591204013';
const roleId = '1564658925591204014';
const secondRoleId = '1564658925591204015';
const userId = '1564658925591204016';
const botId = '1562908276444635258';
const key = `guild:${guildId}:reaction_roles:${messageId}`;

function fixture() {
    const records = new Map();
    const calls = [];
    const owned = new Set();
    const panel = { guildId, channelId, messageId, roles: [roleId, secondRoleId] };
    const permissions = new PermissionsBitField([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions, PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages,
    ]);
    const me = { permissions, roles: { highest: { position: 100 } } };
    const roles = new Collection([roleId, secondRoleId].map((id, i) => [id, {
        id, name: `Role ${i + 1}`, position: i + 1, managed: false,
        permissions: new PermissionsBitField(),
        toString() { return `<@&${id}>`; },
    }]));
    const client = {
        user: { id: botId },
        db: {
            async get(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
            async set(id, data) { records.set(id, structuredClone(data)); return true; },
            async delete(id) { return records.delete(id); },
            async list(prefix) { return [...records.keys()].filter(id => id.startsWith(prefix)); },
        },
        guilds: { cache: new Collection() },
    };
    const member = {
        user: { id: userId, tag: 'trainer' },
        roles: {
            cache: { has: id => owned.has(id) },
            async add(role) { calls.push(['add', role.id]); owned.add(role.id); },
            async remove(role) { calls.push(['remove', role.id]); owned.delete(role.id); },
        },
    };
    const guild = {
        id: guildId, client,
        roles: { cache: roles, async fetch(id) { return roles.get(id); } },
        members: {
            me,
            async fetchMe() { return me; },
            async fetch(options) {
                assert.equal(options.user, userId);
                assert.equal(options.force, true, 'Do not rely on stale member roles between quick clicks');
                return member;
            },
        },
        channels: { cache: new Collection() },
    };
    member.guild = guild;
    const channel = {
        id: channelId, type: ChannelType.GuildText,
        permissionsFor() { return permissions; },
        isTextBased() { return true; },
        messages: {
            async fetch(id) {
                if (typeof id === 'object') return new Collection([[messageId, message]]);
                assert.equal(id, messageId);
                return message;
            },
        },
    };
    guild.channels.fetch = async () => channel;
    guild.channels.cache.set(channelId, channel);
    client.guilds.cache.set(guildId, guild);
    const message = {
        id: messageId, guildId, channelId, guild, channel, client,
        author: { id: botId },
        embeds: [new EmbedBuilder().setTitle('Choose roles').setDescription('My custom panel text')
            .setFooter({ text: 'Select roles below' }).toJSON()],
        components: [{ components: [{ type: 3, custom_id: 'reaction_roles' }] }],
        reactions: { cache: new Collection() },
        async react(emoji) {
            calls.push(['react', emoji]);
            if (!message.reactions.cache.has(emoji)) {
                const seed = {
                    emoji: { name: emoji }, me: true, count: 1,
                    async remove() { calls.push(['clear', emoji]); message.reactions.cache.delete(emoji); },
                    users: { async remove(id) {
                        assert.equal(id, botId);
                        calls.push(['unseed', emoji]);
                        message.reactions.cache.delete(emoji);
                    } },
                };
                message.reactions.cache.set(emoji, seed);
            }
        },
        async edit(payload) {
            calls.push(['edit', payload]);
            message.embeds = payload.embeds.map(embed => embed.toJSON());
            message.components = payload.components;
        },
        async delete() { calls.push(['delete', messageId]); },
    };
    const user = { id: userId, bot: false, tag: 'trainer' };
    const reaction = { client, message, emoji: { name: '1️⃣', id: null } };
    records.set(key, structuredClone(panel));
    return { client, guild, channel, message, user, reaction, records, panel, owned,
        calls, me, roles, permissions, member };
}

async function activeFixture() {
    const f = fixture();
    await syncReactionPanel(f.client, f.message, f.panel);
    f.calls.length = 0;
    return f;
}

test('maps distinct roles to stable emoji; preserves legacy custom emoji and enforces Discord limit', () => {
    const panel = { roles: [roleId, secondRoleId] };
    assert.deepEqual(reactionMappings(panel), { '1️⃣': roleId, '2️⃣': secondRoleId });
    const changed = { roles: [secondRoleId, '1564658925591204017'], emojiRoles: reactionMappings(panel) };
    assert.equal(reactionMappings(changed)['2️⃣'], secondRoleId);
    assert.equal(reactionMappings(changed)['3️⃣'], '1564658925591204017');
    assert.deepEqual(reactionMappings({ roles: { '<:trainer:1564658925591204018>': roleId } }),
        { '1564658925591204018': roleId });
    assert.equal(Object.keys(reactionMappings({ roles: Array.from({ length: 20 }, (_, i) => `${i}`) })).length, 20);
    assert.throws(() => reactionMappings({ roles: Array.from({ length: 21 }, (_, i) => `${i}`) }), /1-20/);
    assert.throws(() => reactionMappings({ roles: [roleId, roleId] }), /distinct/);
});

test('converts an existing dropdown in place and preserves text, roles and mapping on restart', async () => {
    const f = fixture();
    f.owned.add(roleId);
    await syncReactionPanel(f.client, f.message, f.panel);
    assert.equal(f.records.get(key).mode, 'reactions');
    assert.equal(f.message.id, messageId);
    assert.deepEqual(f.message.components, []);
    assert.equal(f.message.embeds[0].title, 'Choose roles');
    assert.equal(f.message.embeds[0].description, 'My custom panel text');
    assert.equal(f.message.embeds[0].footer.text, REACTION_PANEL_FOOTER);
    assert.match(f.message.embeds[0].fields[0].value, new RegExp(`1️⃣ — <@&${roleId}>`));
    assert.deepEqual([...f.owned], [roleId]);
    const before = structuredClone(f.records.get(key));
    await migrateReactionPanels(f.client);
    assert.deepEqual(f.records.get(key), before);
    assert.equal(f.message.reactions.cache.size, 2);
    assert.equal(f.calls.filter(([kind]) => kind === 'add' || kind === 'remove').length, 0);
});

test('reaction event modules assign and remove the mapped role, including uncached partial messages', async () => {
    const f = await activeFixture();
    // These are all the fields available on an uncached partial Discord message.
    f.reaction.message = { id: messageId, guildId, channelId, client: f.client, partial: true };
    f.reaction.partial = true;
    await addEvent.execute(f.reaction, f.user);
    assert.deepEqual([...f.owned], [roleId]);
    await removeEvent.execute(f.reaction, f.user);
    assert.equal(f.owned.size, 0);
    assert.deepEqual(f.calls, [['add', roleId], ['remove', roleId]]);
    assert.equal(addEvent.name, 'messageReactionAdd');
    assert.equal(removeEvent.name, 'messageReactionRemove');
});

test('ignores seed bots, unrelated emoji, unconfigured panels and direct messages', async () => {
    const f = await activeFixture();
    await handleRoleReaction(f.reaction, { ...f.user, id: botId, bot: true }, true);
    await handleRoleReaction(f.reaction, { ...f.user, bot: true }, false);
    await handleRoleReaction({ ...f.reaction, emoji: { name: '❌' } }, f.user, true);
    await handleRoleReaction({ ...f.reaction, message: { ...f.message, guildId: null } }, f.user, true);
    await handleRoleReaction({ ...f.reaction, message: { ...f.message, channelId: 'other' } }, f.user, true);
    f.records.delete(key);
    await handleRoleReaction(f.reaction, f.user, true);
    assert.deepEqual(f.calls, []);
});

test('fetches partial users and ignores other bots after resolution', async () => {
    const f = await activeFixture();
    let fetched = 0;
    await handleRoleReaction(f.reaction, {
        id: userId, partial: true,
        async fetch() { fetched++; return { ...f.user, bot: true }; },
    }, true);
    assert.equal(fetched, 1);
    assert.deepEqual(f.calls, []);
});

test('matches equivalent Unicode reaction names with or without a variation selector', async () => {
    const f = await activeFixture();
    f.reaction.emoji.name = '1\u20E3';
    await handleRoleReaction(f.reaction, f.user, true);
    assert.equal(f.owned.has(roleId), true);
});

test('checks protected roles and hierarchy on both assignment and removal', async t => {
    const errors = t.mock.method(logger, 'error', () => {});
    for (const added of [true, false]) {
        for (const kind of ['managed', 'Administrator', 'ManageRoles', 'MentionEveryone', 'hierarchy', 'everyone', 'no-permission', 'deleted']) {
            const f = await activeFixture();
            f.owned.add(roleId);
            const role = f.roles.get(roleId);
            if (kind === 'managed') role.managed = true;
            else if (['Administrator', 'ManageRoles', 'MentionEveryone'].includes(kind)) role.permissions.add(kind);
            else if (kind === 'hierarchy') role.position = 100;
            else if (kind === 'everyone') role.id = guildId;
            else if (kind === 'no-permission') f.me.permissions.remove(PermissionFlagsBits.ManageRoles);
            else if (kind === 'deleted') f.roles.delete(roleId);
            await handleRoleReaction(f.reaction, f.user, added);
            assert.deepEqual(f.calls, [], `${kind} must not change a role`);
        }
    }
    assert.equal(errors.mock.callCount(), 16);
});

test('serializes fast add/remove clicks and recovers the queue after an API failure', async t => {
    const errors = t.mock.method(logger, 'error', () => {});
    const f = await activeFixture();
    const add = f.member.roles.add;
    f.member.roles.add = async role => {
        await new Promise(resolve => setTimeout(resolve, 5));
        await add(role);
    };
    await Promise.all([
        handleRoleReaction(f.reaction, f.user, true),
        handleRoleReaction(f.reaction, f.user, false),
        handleRoleReaction(f.reaction, f.user, true),
    ]);
    assert.deepEqual(f.calls, [['add', roleId], ['remove', roleId], ['add', roleId]]);
    assert.equal(f.owned.has(roleId), true);
    f.member.roles.remove = async () => { throw new Error('Discord unavailable'); };
    await handleRoleReaction(f.reaction, f.user, false);
    assert.equal(errors.mock.callCount(), 1);
    f.member.roles.remove = async role => { f.owned.delete(role.id); };
    await handleRoleReaction(f.reaction, f.user, false);
    assert.equal(f.owned.size, 0);
});

test('legacy emoji mappings are migrated to an array plus a custom emoji ID lookup', async () => {
    const f = fixture();
    f.panel.roles = { '<:trainer:1564658925591204018>': roleId };
    f.records.set(key, structuredClone(f.panel));
    await migrateReactionPanels(f.client);
    assert.deepEqual(f.records.get(key).roles, [roleId]);
    assert.deepEqual(f.records.get(key).emojiRoles, { '1564658925591204018': roleId });
    f.reaction.emoji = { id: '1564658925591204018', name: 'trainer' };
    await handleRoleReaction(f.reaction, f.user, true);
    assert.equal(f.owned.has(roleId), true);
});

test('failed seeding and editing surface errors and can be retried without remapping', async t => {
    t.mock.method(logger, 'error', () => {});
    const f = fixture();
    const react = f.message.react;
    f.message.react = async () => { throw new Error('Cannot add reactions'); };
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /Cannot add reactions/);
    const mappings = f.records.get(key).emojiRoles;
    f.message.react = react;
    const edit = f.message.edit;
    f.message.edit = async () => { throw new Error('Cannot edit'); };
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /Cannot edit/);
    f.message.edit = edit;
    await migrateReactionPanels(f.client);
    assert.deepEqual(f.records.get(key).emojiRoles, mappings);
    assert.deepEqual(f.message.components, []);
});

test('checks permissions and author before changing an existing panel', async () => {
    const f = fixture();
    f.permissions.remove(PermissionFlagsBits.AddReactions);
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /Add Reactions/);
    assert.equal(f.records.get(key).mode, undefined);
    f.permissions.add(PermissionFlagsBits.AddReactions);
    f.message.author.id = userId;
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /not owned/);
    assert.equal(f.records.get(key).mode, undefined);
});

test('a rejected database write cannot produce a success-shaped converted panel', async () => {
    const f = fixture();
    f.client.db.set = async () => false;
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /Failed to save/);
    assert.equal(f.records.get(key).mode, undefined);
    assert.equal(f.message.components.length, 1);
    assert.equal(f.calls.length, 0);
});

test('removing an option clears obsolete member reactions but never removes existing roles', async () => {
    const f = await activeFixture();
    f.owned.add(roleId);
    f.message.reactions.cache.get('1️⃣').count = 2;
    f.panel.roles = [secondRoleId];
    f.permissions.remove(PermissionFlagsBits.ManageMessages);
    await assert.rejects(syncReactionPanel(f.client, f.message, f.panel), /Manage Messages/);
    f.permissions.add(PermissionFlagsBits.ManageMessages);
    await syncReactionPanel(f.client, f.message, f.panel);
    assert.equal(f.message.reactions.cache.has('1️⃣'), false);
    assert.deepEqual(f.records.get(key).emojiRoles, { '2️⃣': secondRoleId });
    assert.equal(f.owned.has(roleId), true);
    assert.equal(f.calls.filter(([kind]) => kind === 'add' || kind === 'remove').length, 0);
});

test('clears retired member reactions even if the bot seed was already removed', async () => {
    const f = await activeFixture();
    const seed = f.message.reactions.cache.get('1️⃣');
    seed.me = false;
    seed.count = 1;
    f.panel.roles = [secondRoleId];
    await syncReactionPanel(f.client, f.message, f.panel);
    assert.equal(f.message.reactions.cache.has('1️⃣'), false);
    assert.deepEqual(f.records.get(key).emojiRoles, { '2️⃣': secondRoleId });
});

test('panel health recognizes reaction panels and does not recover an unrelated panel', async () => {
    const f = await activeFixture();
    const status = await getReactionRolePanelStatus(f.client, f.guild, f.panel);
    assert.equal(status.exists, true);
    assert.equal(status.message, f.message);
    f.channel.messages.fetch = async id => {
        if (typeof id === 'object') return new Collection([[messageId, f.message]]);
        throw Object.assign(new Error('Unknown message'), { code: 10008 });
    };
    const missing = await getReactionRolePanelStatus(f.client, f.guild, { ...f.panel, messageId: '1564658925591204099' });
    assert.equal(missing.exists, false);
    assert.equal(missing.recoveredId, undefined);
    f.channel.messages.fetch = async () => { throw Object.assign(new Error('Missing access'), { code: 50001 }); };
    await assert.rejects(getReactionRolePanelStatus(f.client, f.guild, f.panel), /Missing access/);
});

test('reconciliation preserves inaccessible panels for retry, but cleans up confirmed deleted messages', async t => {
    t.mock.method(logger, 'warn', () => {});
    const f = fixture();
    f.channel.messages.fetch = async () => { throw Object.assign(new Error('Missing access'), { code: 50001 }); };
    const failed = await reconcileReactionRoleMessages(f.client);
    assert.equal(failed.errors, 1);
    assert.equal(f.records.has(key), true);
    f.channel.messages.fetch = async () => { throw Object.assign(new Error('Unknown message'), { code: 10008 }); };
    const removed = await reconcileReactionRoleMessages(f.client);
    assert.equal(removed.removedMessages, 1);
    assert.equal(f.records.has(key), false);
});

test('rendering preserves exact emoji and instructional footer despite global embed sanitization', () => {
    const panel = { roles: [roleId, secondRoleId] };
    const embed = reactionPanelEmbed(new EmbedBuilder().setTitle('Roles'), panel).toJSON();
    assert.equal(embed.fields[0].value.split('\n').length, 2);
    assert.match(embed.fields[0].value, /1️⃣/);
    assert.equal(embed.footer.text, REACTION_PANEL_FOOTER);
    const custom = reactionPanelEmbed(new EmbedBuilder().setTitle('Roles'),
        { roles: { '<:trainer:1564658925591204018>': roleId } }).toJSON();
    assert.match(custom.fields[0].value, /<:role:1564658925591204018>/);
});

test('slash setup posts a working reaction panel while retaining slash dashboard administration', async () => {
    const f = fixture();
    f.records.delete(key);
    const posted = [];
    const replies = [];
    f.channel.send = async payload => {
        posted.push(payload);
        f.message.embeds = payload.embeds.map(embed => embed.toJSON());
        f.message.components = payload.components;
        return f.message;
    };
    const interaction = {
        id: 'setup-interaction', client: f.client, guildId, guild: f.guild, user: f.user,
        deferred: true,
        options: {
            getSubcommand: () => 'setup',
            getChannel: () => f.channel,
            getString: name => name === 'title' ? 'My role panel' : 'My role description',
            getRole: name => name === 'role1' ? f.roles.get(roleId) : name === 'role2' ? f.roles.get(secondRoleId) : null,
        },
        async editReply(payload) { replies.push(payload); },
    };
    await reactroles.execute(interaction);
    assert.equal(posted.length, 1);
    assert.deepEqual(f.message.components, []);
    assert.match(f.message.embeds[0].fields[0].value, /1️⃣/);
    assert.equal(f.records.get(key).mode, 'reactions');
    assert.equal(replies.length, 1);
    const command = reactroles.data.toJSON();
    assert.equal(command.name, 'reactroles');
    assert.deepEqual(command.options.map(option => option.name), ['setup', 'dashboard']);
});

test('setup cleans up the posted message and its config if reaction seeding fails', async () => {
    const f = fixture();
    f.records.delete(key);
    f.channel.send = async () => f.message;
    f.message.react = async () => { throw new Error('Reaction seeding failed'); };
    const interaction = {
        id: 'failed-setup', client: f.client, guildId, guild: f.guild, user: f.user,
        deferred: true,
        options: {
            getSubcommand: () => 'setup',
            getChannel: () => f.channel,
            getString: () => 'Test panel',
            getRole: name => name === 'role1' ? f.roles.get(roleId) : null,
        },
    };
    await assert.rejects(reactroles.execute(interaction), /Reaction seeding failed/);
    assert.equal(f.records.has(key), false);
    assert.deepEqual(f.calls, [['delete', messageId]]);
});

test('stale dropdown interactions direct members to reactions without changing any roles', async () => {
    const f = await activeFixture();
    f.owned.add(roleId);
    const replies = [];
    await handleReactionRolesSelectMenu({
        id: 'old-dropdown', client: f.client, guildId, guild: f.guild, user: f.user,
        deferred: true, member: f.member, values: [], message: f.message,
        inGuild: () => true,
        async editReply(payload) { replies.push(payload); },
    }, f.client);
    assert.match(replies[0].content, /now uses emoji reactions/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.owned.has(roleId), true);
});
