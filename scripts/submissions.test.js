import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, ComponentType, MessageFlags, ModalSubmitFields, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
    handleSubmissionButton, handleSubmissionForm, MAX_ATTACHMENT_BYTES,
    SUBMISSION_FORMS, submissionModal, submissionPanel, validateSubmissionChannel,
} from '../src/handlers/submissions.js';
import command from '../src/commands/Community/modules/submissions.js';
import appAdmin from '../src/commands/Community/app-admin.js';
import { getPrefixRestriction } from '../src/config/commands/prefixRestrictions.js';
import button from '../src/interactions/buttons/submissions.js';
import modal from '../src/interactions/modals/submissions.js';
import { getGuildConfig } from '../src/services/config/guildConfig.js';
import { getGuildConfigKey } from '../src/utils/database/keys.js';
import { GuildConfigSchema } from '../src/utils/schemas.js';
import { logger } from '../src/utils/logger.js';

logger.silent = true;
const guildId = '1564658925591204011';
const panelId = '1564658925591204012';
const reviewId = '1564658925591204013';
const userId = '1564658925591204014';
const interactionId = '1564658925591204015';
const configKey = getGuildConfigKey(guildId);

function fixture(type = 'bug') {
    const records = new Map([[configKey, {
        prefix: '!', submissions: { [type]: { panelChannelId: panelId, reviewChannelId: reviewId } },
    }]]);
    const calls = [];
    const permissions = new PermissionsBitField([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles,
    ]);
    const client = {
        db: {
            async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
            async set(key, data) { records.set(key, structuredClone(data)); return true; },
        },
    };
    function channel(id) {
        return {
            id, guildId, type: ChannelType.GuildText,
            permissionsFor() { return permissions; },
            permissionOverwrites: { cache: new Collection([[guildId, {
                deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
            }]]) },
            async send(payload) { calls.push(['send', id, payload]); return { id: 'report-message' }; },
        };
    }
    const panel = channel(panelId);
    const review = channel(reviewId);
    const guild = {
        id: guildId,
        members: { async fetchMe() { return { id: 'bot' }; } },
        channels: { async fetch(id, options) {
            assert.equal(options.force, true, 'Re-check current privacy before delivering a report');
            return id === reviewId ? review : null;
        } },
    };
    const answers = Object.fromEntries(SUBMISSION_FORMS[type].fields.map(field => [field.id, field.required ? 'Answer' : '']));
    const uploads = new Collection();
    const interaction = {
        id: interactionId, guildId, guild, client, channelId: panelId,
        user: { id: userId },
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        inGuild() { return true; },
        fields: {
            getTextInputValue(id) { return answers[id]; },
            getUploadedFiles(id) { assert.equal(id, 'attachments'); return uploads; },
        },
        options: {
            getSubcommand() { return 'setup'; },
            getString() { return type; },
            getChannel(name) { return name === 'panel-channel' ? panel : review; },
        },
        async showModal(payload) { calls.push(['modal', payload]); },
        async deferReply(payload) { calls.push(['defer', payload]); },
        async editReply(payload) { calls.push(['reply', payload]); },
    };
    return { client, records, calls, permissions, panel, review, guild, interaction, answers, uploads };
}

test('slash command, buttons and modals use matching persistent handler names', () => {
    const data = appAdmin.data.toJSON();
    assert.equal(data.default_member_permissions, String(PermissionFlagsBits.ManageGuild));
    assert.deepEqual(data.options.find(option => option.name === 'submissions'), command.data.toJSON());
    assert.equal(getPrefixRestriction(appAdmin, ['submissions', 'setup'], name => name).blocked, true);
    for (const type of ['bug', 'feedback']) {
        const panel = submissionPanel(type);
        assert.equal(panel.components[0].toJSON().components[0].custom_id, `${button.name}:${type}`);
        const data = submissionModal(type).toJSON();
        assert.equal(data.custom_id, `${modal.name}:${type}`);
        assert.equal(data.components.length, 5);
        for (const label of data.components.slice(0, 4)) {
            assert.equal(label.type, ComponentType.Label);
            assert.equal(label.component.max_length, 1000);
        }
        assert.equal(data.components[4].component.type, ComponentType.FileUpload);
        assert.equal(data.components[4].component.required, false);
        assert.equal(data.components[4].component.max_values, 3);
    }
    assert.equal(submissionModal('feedback').toJSON().components.filter(row => row.component.required).length, 1);
    assert.throws(() => submissionModal('__proto__'), /Unknown submission type/);
});

test('existing app-admin command routes submission administration to the new group', async () => {
    const f = fixture();
    f.interaction.options.getSubcommandGroup = () => 'submissions';
    await appAdmin.execute(f.interaction);
    assert.equal(f.calls.find(call => call[0] === 'send')[1], panelId);
});

test('setup persists each flow independently, preserves guild config and publishes buttons', async () => {
    const f = fixture();
    f.interaction.options.getString = () => 'feedback';
    await command.execute(f.interaction);
    const config = await getGuildConfig(f.client, guildId);
    assert.equal(config.prefix, '!');
    assert.deepEqual(config.submissions.bug, config.submissions.feedback);
    assert.equal(f.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.equal(f.calls.find(call => call[0] === 'send')[1], panelId);
    assert.equal((await getGuildConfig(f.client, '1564658925591204099')).submissions, undefined);
    const restarted = { db: f.client.db };
    await handleSubmissionButton(f.interaction, restarted, ['feedback']);
    assert.equal(f.calls.at(-1)[0], 'modal');
    assert.equal(GuildConfigSchema.safeParse({ submissions: { bug: { panelChannelId: 'invalid' } } }).success, false);
});

test('disable stops old buttons and in-flight forms without deleting reports or the other flow', async () => {
    const f = fixture();
    f.records.get(configKey).submissions.feedback = { panelChannelId: panelId, reviewChannelId: reviewId };
    f.interaction.options.getSubcommand = () => 'disable';
    await command.execute(f.interaction);
    const config = await getGuildConfig(f.client, guildId);
    assert.equal(config.submissions.bug, null);
    assert.ok(config.submissions.feedback);
    await assert.rejects(handleSubmissionButton(f.interaction, f.client, ['bug']), /disabled or moved/);
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /disabled or moved/);
    assert.equal(f.calls.some(call => call[0] === 'send'), false);
});

test('setup rejects missing manager permission, overlapping channels, public reviews and missing bot permissions', async () => {
    const f = fixture();
    f.interaction.memberPermissions = new PermissionsBitField();
    await assert.rejects(command.execute(f.interaction), /permission denied/);
    f.interaction.memberPermissions.add(PermissionFlagsBits.ManageGuild);
    f.interaction.options.getChannel = () => f.panel;
    await assert.rejects(command.execute(f.interaction), /overlap/);
    f.review.permissionOverwrites.cache.clear();
    await assert.rejects(validateSubmissionChannel(f.guild, f.review, { privateReview: true }), /not private/);
    f.permissions.remove(PermissionFlagsBits.AttachFiles);
    await assert.rejects(validateSubmissionChannel(f.guild, f.review, { privateReview: true }), /permissions/);
    await assert.rejects(validateSubmissionChannel(f.guild, null), /Invalid submission channel/);
    await assert.rejects(validateSubmissionChannel(f.guild, { ...f.panel, guildId: 'another-server' }), /Invalid submission channel/);
    await assert.rejects(validateSubmissionChannel(f.guild, { ...f.panel, type: ChannelType.GuildForum }), /Invalid submission channel/);
    assert.equal(f.calls.some(call => call[0] === 'send'), false);
});

for (const type of ['bug', 'feedback']) {
    test(`${type} sends required and optional answers only to staff, with private confirmation`, async () => {
        const f = fixture(type);
        const optional = SUBMISSION_FORMS[type].fields.find(field => !field.required);
        f.answers[optional.id] = 'Optional details @everyone';
        await handleSubmissionButton(f.interaction, f.client, [type]);
        await handleSubmissionForm(f.interaction, f.client, [type]);
        const sends = f.calls.filter(call => call[0] === 'send');
        assert.equal(sends.length, 1);
        assert.equal(sends[0][1], reviewId);
        const payload = sends[0][2];
        assert.deepEqual(payload.allowedMentions, { parse: [] });
        assert.deepEqual(payload.files, []);
        const embed = payload.embeds[0].toJSON();
        assert.match(embed.description, new RegExp(userId));
        assert.match(embed.footer.text, new RegExp(interactionId));
        assert.ok(embed.fields.some(field => field.value === 'Optional details @everyone'));
        assert.equal(embed.fields.some(field => !field.value), false);
        assert.equal(f.calls.find(call => call[0] === 'defer')[1].flags, MessageFlags.Ephemeral);
        assert.match(f.calls.at(-1)[1].content, /sent privately to staff/);
        assert.equal(f.calls.at(-1)[1].content.includes(reviewId), false);
    });
}

test('native modal files are re-uploaded at the exact allowed byte threshold', async () => {
    const f = fixture();
    const file = { id: 'file', name: 'screenshot.png', url: 'https://cdn.discordapp.com/attachments/example.png', size: MAX_ATTACHMENT_BYTES };
    const fields = new ModalSubmitFields([{
        type: ComponentType.Label,
        component: { type: ComponentType.FileUpload, customId: 'attachments', attachments: new Collection([[file.id, file]]) },
    }]);
    f.interaction.fields.getUploadedFiles = fields.getUploadedFiles.bind(fields);
    await handleSubmissionForm(f.interaction, f.client, ['bug']);
    assert.deepEqual(f.calls.find(call => call[0] === 'send')[2].files, [{ attachment: file.url, name: file.name }]);
    assert.equal(f.calls.find(call => call[0] === 'send')[2].enforceNonce, true);
});

test('report text preserves emoji and formatting, and accepts maximum-length answers', async () => {
    const f = fixture();
    f.answers.summary = '\u{1F41B}';
    f.answers.steps = '  step one\n    step two';
    f.answers.outcome = 'x'.repeat(1000);
    await handleSubmissionForm(f.interaction, f.client, ['bug']);
    const embed = f.calls.find(call => call[0] === 'send')[2].embeds[0].toJSON();
    assert.equal(embed.fields[0].value, '\u{1F41B}');
    assert.equal(embed.fields[1].value, f.answers.steps.trim());
    assert.equal(embed.fields[2].value.length, 1000);
    assert.ok(embed.timestamp);
});

test('oversized attachments, too many files, blank required answers and overlong answers never send', async () => {
    const f = fixture();
    f.uploads.set('large', { size: MAX_ATTACHMENT_BYTES + 1 });
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /too large/);
    f.uploads.clear();
    for (let i = 0; i < 4; i++) f.uploads.set(String(i), { size: 1 });
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /too large/);
    f.uploads.clear();
    f.answers.summary = '   ';
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /Invalid submission answer/);
    f.answers.summary = 'x'.repeat(1001);
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /Invalid submission answer/);
    assert.equal(f.calls.some(call => call[0] === 'send'), false);
});

test('privacy changes, moved panels, other guilds, DMs and unknown types cannot leak a report', async () => {
    const f = fixture();
    f.review.permissionOverwrites.cache.clear();
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /not private/);
    f.interaction.channelId = 'old-panel';
    await assert.rejects(handleSubmissionButton(f.interaction, f.client, ['bug']), /disabled or moved/);
    f.interaction.channelId = panelId;
    f.interaction.guildId = '1564658925591204099';
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /disabled or moved/);
    f.interaction.inGuild = () => false;
    await assert.rejects(handleSubmissionButton(f.interaction, f.client, ['bug']), /outside guild/);
    await assert.rejects(handleSubmissionButton(f.interaction, f.client, ['invalid']), /Unknown submission type/);
    assert.equal(f.calls.some(call => call[0] === 'send'), false);
});

test('database and delivery failures propagate rather than confirming success', async () => {
    const f = fixture();
    f.client.db.set = async () => false;
    await assert.rejects(command.execute(f.interaction), /rejected by database layer/);
    assert.equal(f.calls.some(call => call[0] === 'send'), false);
    f.review.send = async () => { throw new Error('Discord upload failed'); };
    await assert.rejects(handleSubmissionForm(f.interaction, f.client, ['bug']), /Discord upload failed/);
    assert.equal(f.calls.some(call => call[0] === 'reply'), false);
});
