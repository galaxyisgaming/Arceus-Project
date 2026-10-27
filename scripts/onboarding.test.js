import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
    getOnboardingConfig, saveOnboardingConfig, beginOnboarding, agreeToRules, submitScreening,
    getOnboardingMember, reviewOnboarding, evaluateScreening, validateOnboardingSetup,
    assertOnboardingRoleAllowed, assertOnboardingMemberApproved,
} from '../src/services/onboardingService.js';
import { getOnboardingConfigKey, getOnboardingMemberKey } from '../src/utils/database/keys.js';
import {
    onboardingPanel, onboardingStatusPayload, ensureReviewCard, reconcileOnboarding,
    handleOnboardingButton, handleOnboardingForm, handleOnboardingReview, reviewCard,
} from '../src/handlers/onboarding.js';
import onboardingCommand from '../src/commands/Verification/onboarding.js';
import { verifyUser, autoVerifyOnJoin } from '../src/services/verificationService.js';
import { logger } from '../src/utils/logger.js';
import { PostgreSQLDatabase } from '../src/utils/postgresDatabase.js';

logger.silent = true;
const DAY = 86400000;
const guildId = '1564658925591204011';
const userId = '1564658925591204080';
const reviewerId = '1564658925591204081';
const gameplayRoleId = '1564658925591204090';
const gameplayChannelId = '1564658925591204091';
const validAnswers = { invited: 'no', inviter: '', ageGroup: '18+', interest: 'both', conduct: 'yes' };

async function fixture({ enabled = true, ageDays = 30 } = {}) {
    const records = new Map();
    const calls = [];
    const ttls = [];
    const configKey = getOnboardingConfigKey(guildId);
    const memberKey = getOnboardingMemberKey(guildId, userId);
    const client = {
        user: { id: '1562908276444635258' },
        db: {
            isAvailable: () => true,
            async get(key, fallback, options) {
                if (key.includes(':onboarding:')) assert.equal(options.strict, true);
                return records.has(key) ? structuredClone(records.get(key)) : fallback;
            },
            async set(key, value, ttl) { records.set(key, structuredClone(value)); ttls.push([key, ttl]); return true; },
            async list(prefix) { return [...records.keys()].filter(key => key.startsWith(prefix)); },
        },
        guilds: { cache: new Collection() },
    };
    const config = {
        ...await getOnboardingConfig(client, guildId), enabled,
        gameplayRoleId, gameplayChannelId,
    };
    records.set(configKey, config);
    const roleIds = [guildId, config.verifiedRoleId, gameplayRoleId, ...config.reviewerRoleIds];
    const roles = new Collection(roleIds.map((id, index) => [id, {
        id, position: index, managed: false, permissions: new PermissionsBitField(),
    }]));
    const me = {
        id: client.user.id, permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
        roles: { highest: { position: 100 } },
    };
    const guild = {
        id: guildId, client, roles: { cache: roles, async fetch(id) { return roles.get(id); } },
        members: { async fetchMe() { return me; } }, channels: { cache: new Collection() },
    };
    client.guilds.cache.set(guildId, guild);
    const members = new Map();
    function member(id, initial = []) {
        const owned = new Set(initial);
        const instance = {
            id, guild, client, pending: false, joinedTimestamp: Date.now() - 60000,
            user: { id, bot: false, tag: `user-${id}`, createdTimestamp: Date.now() - ageDays * DAY },
            roles: {
                cache: { has: role => owned.has(role) },
                async add(role) { owned.add(role); calls.push(['add', id, role]); },
            },
            async send(payload) { calls.push(['dm', id, payload]); },
            owned,
        };
        members.set(id, instance);
        return instance;
    }
    const applicant = member(userId);
    const reviewer = member(reviewerId, [config.reviewerRoleIds[0]]);
    const gameBot = member(config.gameBotUserId);
    gameBot.user.bot = true;
    guild.members.fetch = async options => {
        const id = typeof options === 'string' ? options : options.user;
        const result = members.get(id);
        if (!result) throw new Error('Unknown member');
        return result;
    };
    const channels = {};
    for (const name of ['application', 'rules', 'roles', 'review', 'welcome', 'gameplay']) {
        const visible = new Set([me.id]);
        if (['application', 'rules'].includes(name)) visible.add(guildId);
        if (['roles', 'welcome'].includes(name)) visible.add(config.verifiedRoleId);
        if (['gameplay', 'review'].includes(name)) for (const id of config.reviewerRoleIds) visible.add(id);
        if (name === 'gameplay') visible.add(gameplayRoleId);
        if (name === 'gameplay') visible.add(gameBot.id);
        const messages = new Collection();
        const channel = {
            id: config[`${name}ChannelId`], type: ChannelType.GuildText,
            parentId: name === 'gameplay' ? config.gameplayCategoryId : null,
            visible,
            permissionsFor(subject) {
                const id = typeof subject === 'string' ? subject : subject.id;
                const bits = new PermissionsBitField();
                if (visible.has(id)) bits.add(PermissionFlagsBits.ViewChannel);
                if (id === me.id) bits.add(PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks);
                if (id === gameplayRoleId || id === gameBot.id) bits.add(PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles);
                return bits;
            },
            messages: {
                async fetch(id) {
                    if (name === 'welcome' && id === config.welcomeMessageId) return { embeds: [{ title: 'Original PokeGalaxy summary' }] };
                    const message = messages.get(id);
                    if (!message) throw Object.assign(new Error('Unknown message'), { code: 10008 });
                    return message;
                },
            },
            async send(payload) {
                calls.push(['send', name, payload]);
                const message = {
                    id: `${config[`${name}ChannelId`]}${messages.size}`, author: client.user,
                    components: [],
                    async edit(data) {
                        message.components = (data.components || []).map(component => ({
                            components: component.components.map(entry => ({ customId: entry.data.custom_id })),
                        }));
                        message.payload = data;
                    },
                };
                await message.edit(payload);
                messages.set(message.id, message);
                return message;
            },
        };
        channels[name] = channel;
        guild.channels.cache.set(channel.id, channel);
    }
    guild.channels.fetch = async id => guild.channels.cache.get(id);
    return { client, guild, applicant, reviewer, records, config, configKey, memberKey, calls, ttls, roles, channels, me };
}

async function agreed(options) {
    const f = await fixture(options);
    await agreeToRules(f.client, f.applicant);
    return f;
}

function interaction(f, overrides = {}) {
    const replies = [];
    return {
        id: 'onboarding-interaction', guild: f.guild, guildId, client: f.client, user: f.applicant.user,
        channelId: f.config.applicationChannelId, replies, deferred: false, member: f.applicant,
        async deferReply(payload) { this.deferred = true; replies.push(['defer', payload]); },
        async editReply(payload) { replies.push(['edit', payload]); },
        async reply(payload) { this.replied = true; replies.push(['reply', payload]); },
        async showModal(modal) { replies.push(['modal', modal.toJSON()]); },
        ...overrides,
    };
}

test('known server defaults are correct and disabled; other servers are not preconfigured', async () => {
    const f = await fixture({ enabled: false });
    const config = await getOnboardingConfig(f.client, guildId);
    assert.equal(config.enabled, false);
    assert.equal(config.applicationChannelId, '1564732887742554122');
    assert.equal(config.rulesChannelId, '1564689977307308162');
    assert.equal(config.reviewChannelId, '1564658929483386930');
    assert.equal(config.welcomeMessageId, '1564660152706011252');
    const other = await getOnboardingConfig(f.client, '1564658925591204099');
    assert.equal(other.enabled, false);
    assert.equal(other.verifiedRoleId, undefined);
});

test('exact seven-day approval boundary; invitation and age category do not change acceptance', () => {
    const now = Date.now();
    for (const invited of ['yes', 'no']) {
        for (const ageGroup of ['18+', 'under 18']) {
            assert.equal(evaluateScreening({ ...validAnswers, invited, ageGroup }, now - 7 * DAY, now).route, 'approve');
        }
    }
    assert.equal(evaluateScreening(validAnswers, now - 7 * DAY + 1, now).route, 'review');
    assert.equal(evaluateScreening(validAnswers, now + 1, now).route, 'review');
    assert.equal(evaluateScreening(validAnswers, NaN, now).route, 'review');
    assert.equal(evaluateScreening({ ...validAnswers, ageGroup: 'unknown' }, now - 30 * DAY, now).route, 'review');
    assert.equal(evaluateScreening({ ...validAnswers, conduct: 'no' }, now - 30 * DAY, now).route, 'correction');
});

test('new members enter a saved queue; screening requires explicit rules agreement', async () => {
    const f = await fixture();
    const queued = await beginOnboarding(f.client, f.applicant);
    assert.equal(queued.status, 'awaiting_rules');
    assert.equal(f.records.get(f.memberKey).agreedAt, undefined);
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /agree to the current rules/);
    const agreedRecord = await agreeToRules(f.client, f.applicant);
    assert.equal(agreedRecord.status, 'questionnaire');
    assert.ok(agreedRecord.agreedAt);
    assert.equal(agreedRecord.rulesVersion, '1');
    assert.equal(f.calls.length, 0);
});

test('adult approval grants only verified access and points to roles before the existing welcome guide', async () => {
    const f = await agreed();
    const approved = await submitScreening(f.client, f.applicant, validAnswers);
    assert.equal(approved.status, 'approved');
    assert.equal(approved.reviewedBy, 'automatic');
    assert.deepEqual([...f.applicant.owned], [f.config.verifiedRoleId]);
    assert.equal(f.calls.filter(call => call[0] === 'send').length, 0, 'Do not repost the webhook welcome embed');
    const payload = onboardingStatusPayload(f.config, guildId, approved);
    assert.equal(payload.components[0].components[0].data.url, `https://discord.com/channels/${guildId}/${f.config.rolesChannelId}`);
    const welcome = interaction(f);
    await handleOnboardingButton(welcome, f.client, ['welcome']);
    const final = welcome.replies.at(-1)[1];
    assert.match(final.components[0].components[0].data.url, new RegExp(f.config.welcomeMessageId));
    assert.equal(JSON.stringify(final).includes('18+'), false);
});

test('minor approval grants the neutral gameplay-access role before verification', async () => {
    const f = await agreed();
    const approved = await submitScreening(f.client, f.applicant, { ...validAnswers, ageGroup: 'under 18' });
    assert.deepEqual(f.calls, [
        ['add', userId, gameplayRoleId], ['add', userId, f.config.verifiedRoleId],
    ]);
    assert.equal(approved.status, 'approved');
    const payload = onboardingStatusPayload(f.config, guildId, approved);
    assert.match(payload.content, new RegExp(gameplayChannelId));
    assert.equal(payload.content.includes('minor'), false);
    assert.equal(payload.content.includes('under 18'), false);
});

test('new accounts enter private review and duplicate submissions/restarts do not duplicate review cards', async () => {
    const f = await agreed({ ageDays: 2 });
    const record = await submitScreening(f.client, f.applicant, { ...validAnswers, inviter: '@everyone **friend**' });
    assert.equal(record.status, 'pending_review');
    assert.equal(f.applicant.owned.size, 0);
    await ensureReviewCard(f.client, f.guild, userId);
    await reconcileOnboarding(f.client);
    await submitScreening(f.client, f.applicant, validAnswers);
    await ensureReviewCard(f.client, f.guild, userId);
    const sent = f.calls.filter(call => call[0] === 'send');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1], 'review');
    assert.deepEqual(sent[0][2].allowedMentions, { parse: [] });
    assert.equal(sent[0][2].enforceNonce, true);
    assert.equal(sent[0][2].components[0].components.length, 3);
    assert.ok(f.records.get(f.memberKey).reviewMessageId);
});

test('staff decisions require one of the configured reviewer roles and cannot be replayed', async () => {
    const f = await agreed({ ageDays: 2 });
    const pending = await submitScreening(f.client, f.applicant, validAnswers);
    await assert.rejects(reviewOnboarding(f.client, f.applicant, userId, pending.id, 'approve', 'ok'), /reviewer roles/);
    await assert.rejects(reviewOnboarding(f.client, f.reviewer, userId, 'old', 'approve', 'ok'), /expired/);
    await assert.rejects(reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'approve', ''), /reason/);
    const approved = await reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'approve', 'Reviewed account');
    assert.equal(approved.status, 'approved');
    assert.equal(approved.reviewedBy, reviewerId);
    assert.equal(approved.decisionReason, 'Reviewed account');
    await assert.rejects(reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'decline', 'other'), /already approved/);
});

test('declining records a reason without granting roles, kicking or banning', async () => {
    const f = await agreed({ ageDays: 1 });
    const pending = await submitScreening(f.client, f.applicant, validAnswers);
    const declined = await reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'decline', 'Needs discussion');
    assert.equal(declined.status, 'declined');
    assert.equal(f.applicant.owned.size, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(onboardingStatusPayload(f.config, guildId, declined).content.includes('not been automatically kicked'), true);
});

test('ambiguous answers can be sent back for correction and old review controls expire', async () => {
    const f = await agreed();
    const pending = await submitScreening(f.client, f.applicant, { ...validAnswers, ageGroup: 'prefer not to say' });
    await assert.rejects(reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'approve', 'ok'), /correct their adult/);
    await ensureReviewCard(f.client, f.guild, userId);
    const corrected = await reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'correct', 'Choose one of the categories');
    assert.equal(corrected.status, 'questionnaire');
    assert.notEqual(corrected.id, pending.id);
    await assert.rejects(reviewOnboarding(f.client, f.reviewer, userId, pending.id, 'approve', 'ok'), /expired/);
    const approved = await submitScreening(f.client, f.applicant, validAnswers);
    assert.equal(approved.status, 'approved');
});

test('conduct refusal remains restricted and no unanswered field qualifies automatically', async () => {
    const f = await agreed();
    await assert.rejects(submitScreening(f.client, f.applicant, { ...validAnswers, conduct: 'no' }), /conduct agreement/);
    assert.equal(f.records.get(f.memberKey).status, 'questionnaire');
    assert.equal(f.calls.length, 0);
    for (const field of ['invited', 'ageGroup', 'interest']) {
        assert.equal(evaluateScreening({ ...validAnswers, [field]: '' }, Date.now() - 30 * DAY).route, 'review');
    }
});

test('concurrent submissions/decisions grant roles exactly once', async () => {
    const f = await agreed();
    const results = await Promise.all([
        submitScreening(f.client, f.applicant, validAnswers),
        submitScreening(f.client, f.applicant, validAnswers),
    ]);
    assert.equal(results.every(result => result.status === 'approved'), true);
    assert.equal(f.calls.filter(call => call[0] === 'add').length, 1);
    const other = await agreed({ ageDays: 1 });
    const pending = await submitScreening(other.client, other.applicant, validAnswers);
    const decisions = await Promise.allSettled([
        reviewOnboarding(other.client, other.reviewer, userId, pending.id, 'approve', 'ok'),
        reviewOnboarding(other.client, other.reviewer, userId, pending.id, 'approve', 'ok'),
    ]);
    assert.equal(decisions.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(other.calls.filter(call => call[0] === 'add').length, 1);
});

test('Discord role failure preserves retryable approval and finishes safely', async () => {
    const f = await agreed();
    const add = f.applicant.roles.add;
    f.applicant.roles.add = async () => { throw new Error('Discord role failure'); };
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /Discord role failure/);
    assert.equal(f.records.get(f.memberKey).status, 'approving');
    assert.equal(f.applicant.owned.size, 0);
    await assert.rejects(assertOnboardingMemberApproved(f.client, f.applicant), /Complete onboarding/);
    f.applicant.roles.add = add;
    const approved = await submitScreening(f.client, f.applicant, {});
    assert.equal(approved.status, 'approved');
    assert.equal(f.applicant.owned.has(f.config.verifiedRoleId), true);
});

test('database write/read failures and memory fallback do not approve anyone', async () => {
    const f = await agreed();
    f.client.db.set = async () => false;
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /could not be saved/);
    assert.equal(f.applicant.owned.size, 0);
    f.client.db.get = async () => { throw new Error('Database connection lost'); };
    await assert.rejects(getOnboardingConfig(f.client, guildId), /could not be loaded/);
    f.client.db.isAvailable = () => false;
    await assert.rejects(getOnboardingConfig(f.client, guildId), /persistent database/);
});

test('failure saving final approval can retry without duplicating granted roles', async () => {
    const f = await agreed();
    const set = f.client.db.set;
    f.client.db.set = async (key, value, ttl) => value.status === 'approved' ? false : set(key, value, ttl);
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /could not be saved/);
    assert.equal(f.records.get(f.memberKey).status, 'approving');
    assert.equal(f.applicant.owned.has(f.config.verifiedRoleId), true);
    await assert.rejects(assertOnboardingMemberApproved(f.client, f.applicant), /Complete onboarding/);
    f.client.db.set = set;
    const approved = await submitScreening(f.client, f.applicant, {});
    assert.equal(approved.status, 'approved');
    assert.equal(f.calls.filter(call => call[0] === 'add').length, 1);
});

test('missing gameplay settings, public review/gameplay or unsafe role hierarchy prevent activation', async () => {
    const f = await fixture();
    await validateOnboardingSetup(f.client, f.guild, f.config);
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, { ...f.config, gameplayChannelId: null }), /gameplay channel/);
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, { ...f.config, gameplayRoleId: null }), /not configured/);
    f.channels.review.visible.add(guildId);
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, f.config), /Remove @everyone/);
    f.channels.review.visible.delete(guildId);
    f.channels.gameplay.visible.add(f.config.verifiedRoleId);
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, f.config), /not the general verified role/);
    f.channels.gameplay.visible.delete(f.config.verifiedRoleId);
    f.roles.get(f.config.verifiedRoleId).position = 100;
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, f.config), /protected/);
});

test('PokeGalaxy must have access to restricted gameplay before approval is enabled', async () => {
    const f = await fixture();
    f.channels.gameplay.visible.delete(f.config.gameBotUserId);
    await assert.rejects(validateOnboardingSetup(f.client, f.guild, f.config), /PokeGalaxy must be able/);
    assert.equal(f.calls.length, 0);
});

test('existing members retain access; new joins cannot reuse an old application', async () => {
    const f = await fixture();
    f.applicant.owned.add(f.config.verifiedRoleId);
    assert.equal((await beginOnboarding(f.client, f.applicant)).status, 'existing_member');
    assert.equal(f.records.has(f.memberKey), false);
    f.applicant.owned.clear();
    await agreeToRules(f.client, f.applicant);
    f.applicant.joinedTimestamp += 1000;
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /agree to the current rules/);
    assert.equal((await beginOnboarding(f.client, f.applicant)).status, 'awaiting_rules');
});

test('Discord native pending members are queued but cannot agree or submit until native screening finishes', async () => {
    const f = await fixture();
    f.applicant.pending = true;
    assert.equal((await beginOnboarding(f.client, f.applicant, true)).status, 'awaiting_rules');
    await assert.rejects(agreeToRules(f.client, f.applicant), /Discord server rules/);
    await assert.rejects(submitScreening(f.client, f.applicant, validAnswers), /Discord server rules/);
    f.applicant.pending = false;
    assert.equal((await agreeToRules(f.client, f.applicant)).status, 'questionnaire');
});

test('legacy verification and automatic join verification cannot bypass enabled onboarding', async () => {
    const f = await fixture();
    await assert.rejects(verifyUser(f.client, guildId, userId), /Onboarding replaces legacy verification/);
    const auto = await autoVerifyOnJoin(f.client, f.guild, f.applicant, { autoVerify: { enabled: true } });
    assert.equal(auto.reason, 'onboarding_required');
    assert.equal(f.applicant.owned.size, 0);
    for (const role of [f.config.verifiedRoleId, gameplayRoleId, ...f.config.reviewerRoleIds]) {
        await assert.rejects(assertOnboardingRoleAllowed(f.client, guildId, role), /reserved/);
    }
    await assertOnboardingRoleAllowed(f.client, guildId, 'ordinary-role');
    await assert.rejects(assertOnboardingMemberApproved(f.client, f.applicant), /Complete onboarding/);
});

test('form handler submits privately; panel never contains stored answers', async () => {
    const f = await agreed();
    const form = interaction(f, { fields: { getTextInputValue: key => validAnswers[key] } });
    await handleOnboardingForm(form, f.client);
    assert.equal(form.replies[0][1].flags, 64);
    assert.equal(f.records.get(f.memberKey).status, 'approved');
    const panel = onboardingPanel(f.config, guildId);
    assert.equal(JSON.stringify(panel).includes(userId), false);
    assert.equal(panel.components[0].components.length, 2);
});

test('screening form renders within Discord component limits and reviewer buttons open a reason modal', async () => {
    const f = await agreed({ ageDays: 1 });
    const startForm = interaction(f);
    await handleOnboardingButton(startForm, f.client, ['form']);
    const form = startForm.replies.at(-1);
    assert.equal(form[0], 'modal', JSON.stringify(form[1]));
    assert.equal(form[1].components.length, 5);
    const pending = await submitScreening(f.client, f.applicant, validAnswers);
    const review = interaction(f, { user: f.reviewer.user, channelId: f.config.reviewChannelId });
    await handleOnboardingButton(review, f.client, ['approve', userId, pending.id]);
    assert.equal(review.replies.at(-1)[0], 'modal');
    assert.equal(review.replies.at(-1)[1].custom_id, `onboarding_review:approve:${userId}:${pending.id}`);
});

test('review handlers require the private queue and persist the staff decision', async () => {
    const f = await agreed({ ageDays: 1 });
    const pending = await submitScreening(f.client, f.applicant, validAnswers);
    await ensureReviewCard(f.client, f.guild, userId);
    const unauthorized = interaction(f);
    await handleOnboardingButton(unauthorized, f.client, ['approve', userId, pending.id]);
    assert.match(unauthorized.replies.at(-1)[1].content, /authorized reviewer role/);
    const review = interaction(f, {
        user: f.reviewer.user, channelId: f.config.reviewChannelId,
        fields: { getTextInputValue: () => 'Reviewed manually' },
    });
    await handleOnboardingReview(review, f.client, ['approve', userId, pending.id]);
    assert.equal(f.records.get(f.memberKey).status, 'approved');
    assert.match(review.replies.at(-1)[1].content, /decision has been saved/);
    assert.equal(f.calls.filter(call => call[0] === 'dm').length, 1);
});

test('new commands validate their registration payload and disabled configuration is persistent', async () => {
    const command = onboardingCommand.data.toJSON();
    assert.equal(command.name, 'onboarding');
    assert.deepEqual(command.options.map(option => option.name), ['dashboard', 'configure', 'check', 'panel', 'enable', 'disable']);
    const f = await fixture({ enabled: false });
    await saveOnboardingConfig(f.client, guildId, f.config);
    assert.equal(f.records.get(f.configKey).enabled, false);
    await assert.rejects(beginOnboarding(f.client, f.applicant), /not enabled/);
    assert.equal(f.calls.length, 0);
});

test('actual slash enable refuses incomplete setup without mutating member access', async () => {
    const f = await fixture({ enabled: false });
    f.records.get(f.configKey).gameplayChannelId = null;
    const enable = interaction(f, {
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
        options: { getSubcommand: () => 'enable' },
    });
    await onboardingCommand.execute(enable);
    assert.match(enable.replies.at(-1)[1].content, /Configure the gameplay channel/);
    assert.equal(f.records.get(f.configKey).enabled, false);
    assert.equal(f.calls.length, 0);
});

test('real PostgreSQL adapter propagates strict onboarding read failures while preserving legacy default behavior', async () => {
    const db = new PostgreSQLDatabase();
    assert.equal(await db.get(getOnboardingConfigKey(guildId), null), null);
    await assert.rejects(db.get(getOnboardingConfigKey(guildId), null, { strict: true }), /unavailable/);
    db.isConnected = true;
    db.pool = { async query() { throw new Error('Query failed'); } };
    assert.equal(await db.get(getOnboardingConfigKey(guildId), null), null);
    await assert.rejects(db.get(getOnboardingConfigKey(guildId), null, { strict: true }), /Query failed/);
    db.pool = { async query() { return { rows: [] }; } };
    assert.equal(await db.get(getOnboardingConfigKey(guildId), null, { strict: true }), null);
    db.pool = { async query() { return { rows: [{ value: { enabled: true } }] }; } };
    assert.deepEqual(await db.get(getOnboardingConfigKey(guildId), null, { strict: true }), { enabled: true });
});

test('records have finite retention and review output never permits mentions', async () => {
    const f = await agreed();
    const record = await submitScreening(f.client, f.applicant, validAnswers);
    assert.equal(f.ttls.find(([key]) => key === f.memberKey)[1], 30 * 86400);
    assert.equal(f.ttls.at(-1)[1], 14 * 86400);
    assert.deepEqual(reviewCard(userId, record).allowedMentions, { parse: [] });
});
