import { randomUUID } from 'node:crypto';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getOnboardingConfigKey, getOnboardingMemberKey } from '../utils/database/keys.js';
import { hasDangerousPermissions } from './reactionRoleService.js';
import { logger } from '../utils/logger.js';
import { Mutex } from '../utils/mutex.js';

const DAY = 86400000;
export const RULES_VERSION = '1';
export const POLICY_VERSION = '1';
export const ADULT = '18+';
export const MINOR = 'under 18';
const TARGET_GUILD = '1564658925591204011';
const defaults = {
    enabled: false,
    minAccountAgeDays: 7,
    rulesVersion: RULES_VERSION,
    applicationChannelId: '1564732887742554122',
    rulesChannelId: '1564689977307308162',
    rolesChannelId: '1564689988119961680',
    reviewChannelId: '1564658929483386930',
    welcomeChannelId: '1564658929483386933',
    welcomeMessageId: '1564660152706011252',
    verifiedRoleId: '1564658925591204012',
    reviewerRoleIds: ['1564658925591204017', '1564658925591204016', '1564658925591204015'],
    gameplayCategoryId: '1564732192129679480',
    gameplayChannelId: null,
    gameplayRoleId: null,
    gameBotUserId: '1562105059238744185',
};
const emptyDefaults = {
    enabled: false, minAccountAgeDays: 7, rulesVersion: RULES_VERSION, reviewerRoleIds: [],
};
export function serializeOnboarding(guildId, userId, work) {
    return Mutex.runExclusive(`onboarding:${guildId}:${userId}`, work);
}

function requirePersistence(client) {
    if (!client.db || (client.db.isAvailable && !client.db.isAvailable())) {
        throw new Error('Onboarding requires the persistent database. Nothing was approved; please try again later.');
    }
}

async function read(client, key) {
    requirePersistence(client);
    try {
        return await client.db.get(key, null, { strict: true });
    } catch (error) {
        logger.error(`Cannot read saved onboarding data for ${key}:`, error);
        throw new Error('Persistent onboarding data could not be loaded. Please try again later.');
    }
}

async function write(client, key, value, ttl = null) {
    requirePersistence(client);
    if (!await client.db.set(key, value, ttl)) {
        throw new Error('Onboarding could not be saved. Please try again; contact staff if this continues.');
    }
}

export async function getOnboardingConfig(client, guildId) {
    const saved = await read(client, getOnboardingConfigKey(guildId));
    return { ...(guildId === TARGET_GUILD ? defaults : emptyDefaults), ...saved };
}

export async function saveOnboardingConfig(client, guildId, config) {
    await write(client, getOnboardingConfigKey(guildId), config);
}

export async function getOnboardingMember(client, guildId, userId) {
    return read(client, getOnboardingMemberKey(guildId, userId));
}

async function saveMember(client, guildId, userId, record) {
    const retentionDays = ['approved', 'declined'].includes(record.status) ? 14 : 30;
    await write(client, getOnboardingMemberKey(guildId, userId), record, retentionDays * 86400);
    return record;
}

export async function saveReviewMessage(client, guildId, userId, record, channelId, messageId) {
    return saveMember(client, guildId, userId, { ...record, reviewChannelId: channelId, reviewMessageId: messageId });
}

export function isCurrentJoin(record, member) {
    return record?.joinedTimestamp === member.joinedTimestamp;
}

export function assertScreeningAccess(config, member, joining = false) {
    if (!config.enabled) throw new Error('Onboarding is not enabled yet. Please contact staff.');
    if (member.user.bot) throw new Error('Bots do not use member onboarding.');
    if (member.pending && !joining) throw new Error('Complete Discord server rules screening first, then try again.');
}

async function assignableRole(guild, id) {
    const role = id && await guild.roles.fetch(id);
    const me = await guild.members.fetchMe({ force: true });
    if (!role || role.managed || role.id === guild.id || hasDangerousPermissions(role) ||
        !me.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= me.roles.highest.position) {
        throw new Error(`Role ${id || '(not configured)'} is missing, protected, or not below Arceus's highest role.`);
    }
    return role;
}

function canView(channel, subject) {
    return channel.permissionsFor(subject)?.has(PermissionFlagsBits.ViewChannel) === true;
}

export async function validateOnboardingSetup(client, guild, config) {
    requirePersistence(client);
    const channels = {};
    for (const name of ['application', 'rules', 'roles', 'review', 'welcome', 'gameplay']) {
        const id = config[`${name}ChannelId`];
        if (!id) throw new Error(`Configure the ${name} channel before enabling onboarding.`);
        const channel = await guild.channels.fetch(id);
        if (!channel || channel.type !== ChannelType.GuildText) throw new Error(`${name} must be a server text channel.`);
        channels[name] = channel;
    }
    if (new Set(Object.values(channels).map(channel => channel.id)).size !== 6) {
        throw new Error('Rules, onboarding, optional roles, review, welcome and restricted gameplay must use separate channels.');
    }
    if (channels.gameplay.parentId !== config.gameplayCategoryId) {
        throw new Error('The restricted gameplay channel must be inside the configured gameplay category.');
    }
    const verified = await assignableRole(guild, config.verifiedRoleId);
    const gameplay = await assignableRole(guild, config.gameplayRoleId);
    if (verified.id === gameplay.id || config.reviewerRoleIds.includes(verified.id) ||
        config.reviewerRoleIds.includes(gameplay.id)) throw new Error('Access roles and reviewer roles must be distinct.');
    if (!config.reviewerRoleIds.length) throw new Error('Configure at least one reviewer role.');
    for (const id of config.reviewerRoleIds) {
        if (id === guild.id || !await guild.roles.fetch(id)) throw new Error(`Invalid reviewer role: ${id}`);
        if (!canView(channels.review, id)) throw new Error(`Reviewer role ${id} cannot see the review queue.`);
        if (!canView(channels.gameplay, id)) throw new Error(`Reviewer role ${id} cannot see restricted gameplay.`);
    }
    const me = await guild.members.fetchMe({ force: true });
    for (const [name, channel] of Object.entries(channels)) {
        const permissions = channel.permissionsFor(me);
        const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
        if (['application', 'review'].includes(name)) required.push(PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks);
        if (!permissions?.has(required)) throw new Error(`Arceus is missing required permissions in the ${name} channel.`);
    }
    for (const name of ['rules', 'application']) {
        if (!canView(channels[name], guild.id)) throw new Error(`Newcomers (@everyone) must be able to see the ${name} channel.`);
    }
    for (const name of ['roles', 'welcome', 'gameplay', 'review']) {
        if (canView(channels[name], guild.id)) throw new Error(`Remove @everyone access from the ${name} channel before enabling.`);
    }
    if (canView(channels.review, verified) || canView(channels.review, gameplay)) {
        throw new Error('Member access roles must not expose the private review queue.');
    }
    if (!canView(channels.gameplay, gameplay) || canView(channels.gameplay, verified)) {
        throw new Error('Restricted gameplay must be visible to its dedicated access role, not the general verified role.');
    }
    if (!channels.gameplay.permissionsFor(gameplay)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
    ])) throw new Error('The gameplay access role must be able to view, send and read message history in restricted gameplay.');
    if (!config.gameBotUserId) throw new Error('Configure the PokeGalaxy bot user before enabling onboarding.');
    const gameBot = await guild.members.fetch({ user: config.gameBotUserId, force: true });
    if (!gameBot.user.bot || !channels.gameplay.permissionsFor(gameBot)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
    ])) throw new Error('PokeGalaxy must be able to view, send, read history, embed and attach files in restricted gameplay.');
    for (const name of ['roles', 'welcome']) {
        if (!canView(channels[name], verified)) throw new Error(`Verified members must be able to view ${name}.`);
    }
    const welcome = await channels.welcome.messages.fetch(config.welcomeMessageId);
    if (!welcome?.embeds?.length) throw new Error('The configured PokeGalaxy welcome message must contain the existing summary embed.');
    return channels;
}

export async function beginOnboarding(client, member, joining = false) {
    return serializeOnboarding(member.guild.id, member.id, async () => {
        const config = await getOnboardingConfig(client, member.guild.id);
        assertScreeningAccess(config, member, joining);
        const previous = await getOnboardingMember(client, member.guild.id, member.id);
        if (isCurrentJoin(previous, member)) return previous;
        if (member.roles.cache.has(config.verifiedRoleId)) return { status: 'existing_member' };
        return saveMember(client, member.guild.id, member.id, {
            status: 'awaiting_rules', id: randomUUID(), joinedTimestamp: member.joinedTimestamp,
            createdAt: Date.now(), policyVersion: POLICY_VERSION,
        });
    });
}

export async function agreeToRules(client, member) {
    await beginOnboarding(client, member);
    return serializeOnboarding(member.guild.id, member.id, async () => {
        const config = await getOnboardingConfig(client, member.guild.id);
        assertScreeningAccess(config, member);
        await validateOnboardingSetup(client, member.guild, config);
        const record = await getOnboardingMember(client, member.guild.id, member.id);
        if (!isCurrentJoin(record, member)) throw new Error('This onboarding session expired. Start again.');
        if (['pending_review', 'approving', 'approved', 'declined'].includes(record.status)) return record;
        return saveMember(client, member.guild.id, member.id, {
            ...record, status: 'questionnaire', rulesVersion: config.rulesVersion, agreedAt: Date.now(),
        });
    });
}

export function evaluateScreening(answers, createdTimestamp, now = Date.now(), minDays = 7) {
    const invited = String(answers.invited || '').trim().toLowerCase();
    const ageGroup = String(answers.ageGroup || '').trim().toLowerCase();
    const interest = String(answers.interest || '').trim().toLowerCase();
    const conduct = String(answers.conduct || '').trim().toLowerCase();
    if (conduct !== 'yes') return { route: 'correction', reason: 'Accept the conduct agreement to continue.' };
    const reasons = [];
    if (!['yes', 'no'].includes(invited)) reasons.push('Invitation answer needs clarification.');
    if (![ADULT, MINOR].includes(ageGroup)) reasons.push('Adult/minor answer needs clarification.');
    if (!['pokegalaxy', 'community', 'both', 'other'].includes(interest)) reasons.push('Interest answer needs clarification.');
    if (!Number.isSafeInteger(createdTimestamp) || createdTimestamp <= 0 || createdTimestamp > now) {
        reasons.push('Discord account creation date could not be validated.');
    } else if (now - createdTimestamp < minDays * DAY) {
        reasons.push(`Discord account is less than ${minDays} days old.`);
    }
    return { route: reasons.length ? 'review' : 'approve', reasons, ageGroup, invited, interest };
}

async function approveRecord(client, guild, member, config, record, reviewerId) {
    if (![ADULT, MINOR].includes(record.answers?.ageGroup)) {
        throw new Error('Ask the applicant to correct their adult/minor category before approval.');
    }
    await assignableRole(guild, config.verifiedRoleId);
    if (record.answers.ageGroup === MINOR) await assignableRole(guild, config.gameplayRoleId);
    const approving = { ...record, status: 'approving', reviewedBy: reviewerId, decisionAt: record.decisionAt || Date.now() };
    await saveMember(client, guild.id, member.id, approving);
    // The verified role is granted last. Retryable state is persisted before any Discord change.
    if (record.answers.ageGroup === MINOR && !member.roles.cache.has(config.gameplayRoleId)) {
        await member.roles.add(config.gameplayRoleId, 'Onboarding gameplay access');
    }
    if (!member.roles.cache.has(config.verifiedRoleId)) await member.roles.add(config.verifiedRoleId, 'Onboarding approved');
    const approved = await saveMember(client, guild.id, member.id, {
        ...approving, status: 'approved', approvedAt: Date.now(),
    });
    logger.info(`Onboarding approved for ${member.id} in ${guild.id} by ${reviewerId}.`);
    return approved;
}

export async function submitScreening(client, member, answers) {
    return serializeOnboarding(member.guild.id, member.id, async () => {
        const config = await getOnboardingConfig(client, member.guild.id);
        assertScreeningAccess(config, member);
        await validateOnboardingSetup(client, member.guild, config);
        const record = await getOnboardingMember(client, member.guild.id, member.id);
        if (!isCurrentJoin(record, member) || !record.agreedAt || record.rulesVersion !== config.rulesVersion) {
            throw new Error('Read and agree to the current rules before submitting screening.');
        }
        if (record.status === 'approving') return approveRecord(client, member.guild, member, config, record, record.reviewedBy);
        if (['approved', 'pending_review', 'declined'].includes(record.status)) return record;
        const evaluation = evaluateScreening(answers, member.user.createdTimestamp, Date.now(), config.minAccountAgeDays);
        if (evaluation.route === 'correction') throw new Error(evaluation.reason);
        const submitted = {
            ...record, status: 'pending_review', submittedAt: Date.now(),
            reviewedBy: null, decisionReason: null, decisionAt: null,
            answers: {
                invited: evaluation.invited, ageGroup: evaluation.ageGroup, interest: evaluation.interest,
                inviter: String(answers.inviter || '').trim().slice(0, 100), conduct: 'yes',
            },
            accountCreatedAt: member.user.createdTimestamp,
            reviewReasons: evaluation.reasons,
        };
        await saveMember(client, member.guild.id, member.id, submitted);
        if (evaluation.route === 'approve') return approveRecord(client, member.guild, member, config, submitted, 'automatic');
        return submitted;
    });
}

export async function reviewOnboarding(client, reviewer, userId, recordId, action, reason) {
    return serializeOnboarding(reviewer.guild.id, userId, async () => {
        const guild = reviewer.guild;
        const config = await getOnboardingConfig(client, guild.id);
        if (!config.enabled) throw new Error('Onboarding is disabled.');
        if (!config.reviewerRoleIds.some(id => reviewer.roles.cache.has(id))) {
            throw new Error('Only the configured onboarding reviewer roles can decide applications.');
        }
        if (!['approve', 'decline', 'correct'].includes(action)) throw new Error('Invalid review action.');
        const record = await getOnboardingMember(client, guild.id, userId);
        if (!record || record.id !== recordId) throw new Error('This review card expired or was replaced.');
        if (['approved', 'declined'].includes(record.status)) throw new Error(`This application was already ${record.status}.`);
        if (!['pending_review', 'approving'].includes(record.status)) throw new Error('This application is not awaiting review.');
        const member = await guild.members.fetch({ user: userId, force: true });
        if (!isCurrentJoin(record, member)) throw new Error('The member left and rejoined. They must submit a new application.');
        if (!String(reason || '').trim()) throw new Error('A staff decision reason is required.');
        if (action === 'correct') {
            if (record.status === 'approving') throw new Error('Approval is already in progress. Retry approval to finish it.');
            return saveMember(client, guild.id, userId, {
                ...record, id: randomUUID(), status: 'questionnaire', reviewedBy: reviewer.id,
                decisionReason: reason.slice(0, 500),
            });
        }
        if (action === 'decline') {
            if (record.status === 'approving') throw new Error('Approval is already in progress. Retry approval to finish it.');
            return saveMember(client, guild.id, userId, {
                ...record, status: 'declined', reviewedBy: reviewer.id, decisionAt: Date.now(), decisionReason: reason.slice(0, 500),
            });
        }
        if (member.pending) throw new Error('The member must finish Discord rules screening first.');
        if (record.rulesVersion !== config.rulesVersion) throw new Error('Rules have changed. The member must agree to them again.');
        await validateOnboardingSetup(client, guild, config);
        return approveRecord(client, guild, member, config, { ...record, decisionReason: reason.slice(0, 500) }, reviewer.id);
    });
}

export async function assertOnboardingRoleAllowed(client, guildId, roleId) {
    const config = await getOnboardingConfig(client, guildId);
    if (config.enabled && [config.verifiedRoleId, config.gameplayRoleId, ...config.reviewerRoleIds].includes(roleId)) {
        throw new Error('This role is reserved for onboarding approval and cannot be granted by another feature.');
    }
}

export async function assertOnboardingMemberApproved(client, member) {
    const config = await getOnboardingConfig(client, member.guild.id);
    if (!config.enabled) return;
    const record = await getOnboardingMember(client, member.guild.id, member.id);
    if (!member.roles.cache.has(config.verifiedRoleId) ||
        (isCurrentJoin(record, member) && record.status !== 'approved')) {
        throw new Error(`Complete onboarding in <#${config.applicationChannelId}> before selecting optional roles.`);
    }
}
