import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, Collection, ComponentType, MessageFlags, ModalSubmitFields, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
    handleSubmissionButton, handleSubmissionForm, MAX_ATTACHMENT_BYTES,
    SUBMISSION_FORMS, submissionModal, submissionPanel, validateSubmissionChannel,
} from '../src/handlers/submissions.js';
import command from '../src/commands/Community/bugreport.js';
import surveyCommand from '../src/commands/Community/survey.js';
import {
    DEFAULT_SURVEY_QUESTIONS, handleSurveyAdminButton, handleSurveyButton, handleSurveyEdit,
    handleSurveyForm, handleSurveySelect, parseSurveyQuestions, surveyDashboard, surveyEditor,
} from '../src/handlers/surveys.js';
import { loadCommands, registerCommands } from '../src/handlers/loaders/commandLoader.js';
import loadInteractions from '../src/handlers/loaders/interactions.js';
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
            return id === reviewId ? review : id === panelId ? panel : null;
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
    assert.equal(surveyCommand.data.toJSON().default_member_permissions, String(PermissionFlagsBits.ManageGuild));
    assert.equal(command.data.toJSON().default_member_permissions, undefined, 'Members can submit bugs');
    assert.equal(getPrefixRestriction(command, ['submit'], name => name).blocked, true);
    for (const type of ['bug']) {
        const panel = submissionPanel(type);
        assert.equal(panel.components[0].toJSON().components[0].custom_id, `${button.name}:${type}`);
        const data = submissionModal(type).toJSON();
        assert.equal(data.custom_id, `${modal.name}:${type}:panel`);
        assert.equal(data.components.length, 5);
        for (const label of data.components.slice(0, 4)) {
            assert.equal(label.type, ComponentType.Label);
            assert.equal(label.component.max_length, 1000);
        }
        assert.equal(data.components[4].component.type, ComponentType.FileUpload);
        assert.equal(data.components[4].component.required, false);
        assert.equal(data.components[4].component.max_values, 3);
    }
    assert.throws(() => submissionModal('__proto__'), /Unknown submission type/);
});

test('members can submit bugs by slash command outside the configured panel channel', async () => {
    const f = fixture();
    f.interaction.memberPermissions = new PermissionsBitField();
    f.interaction.channelId = 'another-channel';
    f.interaction.options.getSubcommand = () => 'submit';
    await command.execute(f.interaction);
    assert.equal(f.calls[0][1].toJSON().custom_id, 'submission_form:bug:direct');
    await handleSubmissionForm(f.interaction, f.client, ['bug', 'direct']);
    assert.equal(f.calls.find(call => call[0] === 'send')[1], reviewId);
});

test('bug setup preserves guild config and publishes a restart-safe button', async () => {
    const f = fixture();
    await command.execute(f.interaction);
    const config = await getGuildConfig(f.client, guildId);
    assert.equal(config.prefix, '!');
    assert.deepEqual(config.submissions.bug, { panelChannelId: panelId, reviewChannelId: reviewId });
    assert.equal(f.calls[0][1].flags, MessageFlags.Ephemeral);
    assert.equal(f.calls.find(call => call[0] === 'send')[1], panelId);
    assert.equal((await getGuildConfig(f.client, '1564658925591204099')).submissions, undefined);
    const restarted = { db: f.client.db };
    await handleSubmissionButton(f.interaction, restarted, ['bug']);
    assert.equal(f.calls.at(-1)[0], 'modal');
    assert.equal(GuildConfigSchema.safeParse({ submissions: { bug: { panelChannelId: 'invalid' } } }).success, false);
});

test('disable stops old buttons and in-flight forms without deleting reports', async () => {
    const f = fixture();
    f.interaction.options.getSubcommand = () => 'disable';
    await command.execute(f.interaction);
    const config = await getGuildConfig(f.client, guildId);
    assert.equal(config.submissions.bug, null);
    assert.equal(config.prefix, '!');
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

for (const type of ['bug']) {
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

function surveyFixture() {
    const f = fixture();
    Object.assign(f.answers, {
        title: 'Community Feedback',
        description: 'Tell staff what you think.',
        questions: DEFAULT_SURVEY_QUESTIONS.map(question => `${question.required ? '*' : ''}${question.label}`).join('\n'),
    });
    return f;
}

async function createSurvey(f, name = 'feedback') {
    await handleSurveyEdit(f.interaction, f.client, ['create', name, panelId, reviewId]);
    return (await getGuildConfig(f.client, guildId)).surveys[name];
}

test('survey create and edit commands open editors without prematurely deferring', async () => {
    const f = surveyFixture();
    f.interaction.options.getSubcommand = () => 'create';
    f.interaction.options.getString = () => 'feedback';
    await surveyCommand.execute(f.interaction);
    const data = f.calls[0][1].toJSON();
    assert.equal(data.custom_id, `survey_edit:create:feedback:${panelId}:${reviewId}`);
    assert.equal(data.components.length, 3);
    assert.match(data.components[2].component.value, /\*First impression/);
    await createSurvey(f);
    f.interaction.options.getSubcommand = () => 'edit';
    f.interaction.options.getChannel = () => null;
    await surveyCommand.execute(f.interaction);
    assert.equal(f.calls.at(-1)[1].toJSON().custom_id, `survey_edit:edit:feedback:${panelId}:${reviewId}`);
    assert.ok(surveyEditor('create', 'a'.repeat(24), panelId, reviewId).toJSON().custom_id.length <= 100);
});

test('multiple named surveys persist independently of bug configuration and survive restart', async () => {
    const f = surveyFixture();
    const first = await createSurvey(f);
    assert.equal(first.enabled, false);
    assert.equal(first.questions.length, 4);
    assert.equal(first.questions.filter(question => question.required).length, 1);
    f.answers.title = 'Balance Survey';
    const second = await createSurvey(f, 'balance');
    assert.equal(second.title, 'Balance Survey');
    const restarted = { db: f.client.db };
    const config = await getGuildConfig(restarted, guildId);
    assert.equal(config.surveys.feedback.title, 'Community Feedback');
    assert.equal(config.surveys.balance.title, 'Balance Survey');
    assert.ok(config.submissions.bug);
    assert.equal(config.prefix, '!');
    assert.equal((await getGuildConfig(restarted, '1564658925591204099')).surveys, undefined);
});

test('survey question parser enforces exact count, lengths and required markers', () => {
    assert.deepEqual(parseSurveyQuestions('*Overall?\nFeatures?\n\nBalance?'), [
        { label: 'Overall?', required: true },
        { label: 'Features?', required: false },
        { label: 'Balance?', required: false },
    ]);
    assert.equal(parseSurveyQuestions(`*${'a'.repeat(45)}`)[0].label.length, 45);
    for (const invalid of ['', '*', 'a\nb\nc\nd\ne', 'a'.repeat(46)]) {
        assert.throws(() => parseSurveyQuestions(invalid), /Invalid survey questions/);
    }
});

test('survey creation rejects duplicate names, invalid names, empty details and overlapping channels', async () => {
    const f = surveyFixture();
    await createSurvey(f);
    await assert.rejects(createSurvey(f), /already exists/);
    await assert.rejects(createSurvey(f, 'Invalid Name'), /Invalid survey name/);
    await assert.rejects(createSurvey(f, '__proto__'), /Invalid survey name/);
    f.answers.title = ' ';
    await assert.rejects(createSurvey(f, 'blank-title'), /Invalid survey details/);
    f.answers.title = 'Title';
    await assert.rejects(handleSurveyEdit(f.interaction, f.client, ['create', 'overlap', panelId, panelId]), /overlap/);
    f.interaction.options.getSubcommand = () => 'create';
    f.interaction.options.getString = () => 'feedback';
    await assert.rejects(surveyCommand.execute(f.interaction), /already exists/);
    await assert.rejects(handleSurveyEdit(f.interaction, f.client, ['edit', 'missing', panelId, reviewId]), /not found/);
});

test('survey dashboard handles up to 25 surveys without exceeding Discord component limits', async () => {
    const f = surveyFixture();
    const survey = await createSurvey(f);
    const surveys = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`survey-${i}`, survey]));
    f.records.get(configKey).surveys = surveys;
    const payload = surveyDashboard(surveys, userId, 'survey-0');
    assert.equal(payload.components[0].toJSON().components[0].options.length, 25);
    assert.equal(payload.components[1].toJSON().components.length, 3);
    await assert.rejects(createSurvey(f, 'overflow'), /limit reached/);
    assert.equal(GuildConfigSchema.safeParse({ surveys: { ...surveys, overflow: survey } }).success, false);
    assert.match(surveyDashboard({}, userId).embeds[0].toJSON().description, /0\/25/);
});

test('publishing a survey enables a restart-safe button and private native form with optional uploads', async () => {
    const f = surveyFixture();
    const survey = await createSurvey(f);
    await assert.rejects(handleSurveyButton(f.interaction, f.client, ['feedback']), /disabled or moved/);
    f.interaction.options.getSubcommand = () => 'publish';
    f.interaction.options.getString = () => 'feedback';
    await surveyCommand.execute(f.interaction);
    assert.equal((await getGuildConfig(f.client, guildId)).surveys.feedback.enabled, true);
    const panel = f.calls.find(call => call[0] === 'send')[2];
    assert.equal(panel.components[0].toJSON().components[0].custom_id, 'survey_submit:feedback');
    await handleSurveyButton(f.interaction, { db: f.client.db }, ['feedback']);
    const data = f.calls.at(-1)[1].toJSON();
    assert.equal(data.custom_id, `survey_form:feedback:${survey.revision}`);
    assert.equal(data.components.length, 5);
    assert.equal(data.components[0].component.required, true);
    assert.equal(data.components[1].component.required, false);
    assert.equal(data.components[4].component.type, ComponentType.FileUpload);
    Object.assign(f.answers, { question_0: '4/5 - great!', question_1: '', question_2: 'Balance changes', question_3: '' });
    f.uploads.set('image', { name: 'balance.png', url: 'https://cdn.discordapp.com/attachments/balance.png', size: 10 });
    await handleSurveyForm(f.interaction, f.client, ['feedback', survey.revision]);
    const response = f.calls.filter(call => call[0] === 'send').at(-1);
    assert.equal(response[1], reviewId);
    assert.equal(response[2].embeds[0].toJSON().fields.length, 2);
    assert.equal(response[2].embeds[0].toJSON().fields[0].value, '4/5 - great!');
    assert.deepEqual(response[2].files, [{ name: 'balance.png', attachment: 'https://cdn.discordapp.com/attachments/balance.png' }]);
    assert.match(f.calls.at(-1)[1].content, /survey response \(feedback\).*sent privately/);
});

test('editing survey questions persists changes and rejects outdated in-flight responses', async () => {
    const f = surveyFixture();
    const original = await createSurvey(f);
    f.interaction.options.getSubcommand = () => 'publish';
    f.interaction.options.getString = () => 'feedback';
    await surveyCommand.execute(f.interaction);
    f.interaction.id = '1564658925591204090';
    f.answers.title = 'New title';
    f.answers.questions = '*New question?\nOptional question?';
    await handleSurveyEdit(f.interaction, f.client, ['edit', 'feedback', panelId, reviewId]);
    const updated = (await getGuildConfig(f.client, guildId)).surveys.feedback;
    assert.equal(updated.title, 'New title');
    assert.equal(updated.enabled, true);
    assert.deepEqual(updated.questions, [{ label: 'New question?', required: true }, { label: 'Optional question?', required: false }]);
    await assert.rejects(handleSurveyForm(f.interaction, f.client, ['feedback', original.revision]), /changed during response/);
    await handleSurveyButton(f.interaction, f.client, ['feedback']);
    assert.equal(f.calls.at(-1)[1].toJSON().components[0].label, 'New question?');
    assert.equal(f.calls.filter(call => call[0] === 'send').length, 1, 'Only the panel was posted, never the outdated response');
});

test('dashboard select/edit/publish/disable actions work and recheck manager and dashboard ownership', async () => {
    const f = surveyFixture();
    const survey = await createSurvey(f);
    f.interaction.values = ['feedback'];
    f.interaction.deferUpdate = async () => f.calls.push(['deferUpdate']);
    await handleSurveySelect(f.interaction, f.client, [userId]);
    assert.equal(f.calls.at(-1)[1].embeds[0].toJSON().title, 'Survey: feedback');
    await handleSurveyAdminButton(f.interaction, f.client, ['edit', 'feedback', userId]);
    assert.match(f.calls.at(-1)[1].toJSON().custom_id, /survey_edit:edit:feedback/);
    await handleSurveyAdminButton(f.interaction, f.client, ['publish', 'feedback', userId]);
    await handleSurveyAdminButton(f.interaction, f.client, ['disable', 'feedback', userId]);
    assert.equal((await getGuildConfig(f.client, guildId)).surveys.feedback.enabled, false);
    await assert.rejects(handleSurveyButton(f.interaction, f.client, ['feedback']), /disabled or moved/);
    await assert.rejects(handleSurveyForm(f.interaction, f.client, ['feedback', survey.revision]), /disabled or moved/);
    await assert.rejects(handleSurveySelect(f.interaction, f.client, ['another-admin']), /another user/);
    f.interaction.memberPermissions = new PermissionsBitField();
    await assert.rejects(handleSurveyAdminButton(f.interaction, f.client, ['publish', 'feedback', userId]), /permission denied/);
    await assert.rejects(handleSurveyEdit(f.interaction, f.client, ['edit', 'feedback', panelId, reviewId]), /permission denied/);
    await assert.rejects(surveyCommand.execute(f.interaction), /permission denied/);
    f.interaction.inGuild = () => false;
    await assert.rejects(handleSurveyButton(f.interaction, f.client, ['feedback']), /outside guild/);
});

test('survey revalidates privacy on publish and submit, and rejects empty optional-only responses', async () => {
    const f = surveyFixture();
    f.answers.questions = 'Optional one?\nOptional two?';
    const survey = await createSurvey(f);
    f.interaction.deferUpdate = async () => {};
    f.review.permissionOverwrites.cache.clear();
    await assert.rejects(handleSurveyAdminButton(f.interaction, f.client, ['publish', 'feedback', userId]), /not private/);
    assert.equal((await getGuildConfig(f.client, guildId)).surveys.feedback.enabled, false);
    f.review.permissionOverwrites.cache.set(guildId, { deny: new PermissionsBitField(PermissionFlagsBits.ViewChannel) });
    await handleSurveyAdminButton(f.interaction, f.client, ['publish', 'feedback', userId]);
    Object.assign(f.answers, { question_0: '', question_1: '' });
    await assert.rejects(handleSurveyForm(f.interaction, f.client, ['feedback', survey.revision]), /Empty submission/);
    f.answers.question_0 = 'My suggestion';
    f.review.permissionOverwrites.cache.clear();
    await assert.rejects(handleSurveyForm(f.interaction, f.client, ['feedback', survey.revision]), /not private/);
    f.interaction.channelId = 'old-panel';
    await assert.rejects(handleSurveyButton(f.interaction, f.client, ['feedback']), /disabled or moved/);
});

test('survey autocomplete lists only the current guild surveys', async () => {
    const f = surveyFixture();
    await createSurvey(f);
    await createSurvey(f, 'balance');
    f.interaction.options.getFocused = () => 'bal';
    f.interaction.respond = async payload => f.calls.push(['choices', payload]);
    await surveyCommand.autocomplete(f.interaction);
    assert.deepEqual(f.calls.at(-1)[1], [{ name: 'balance', value: 'balance' }]);
    f.interaction.guildId = '1564658925591204099';
    await surveyCommand.autocomplete(f.interaction);
    assert.deepEqual(f.calls.at(-1)[1], []);
});

test('survey setup preserves historical XP configuration, member data and economy records', async () => {
    const f = surveyFixture();
    const keys = [
        `guild:${guildId}:leveling:config`,
        `guild:${guildId}:leveling:users:${userId}`,
        `guild:${guildId}:economy:${userId}`,
    ];
    const historical = [
        { enabled: true, roleRewards: [{ level: 10, roleId: userId }] },
        { xp: 1234, level: 10 },
        { wallet: 100, bank: 200 },
    ];
    keys.forEach((key, index) => f.records.set(key, structuredClone(historical[index])));
    await createSurvey(f);
    await command.execute(f.interaction);
    keys.forEach((key, index) => assert.deepEqual(f.records.get(key), historical[index]));
});

test('real command registration removes all six leveling commands and includes both dedicated commands', async () => {
    const client = {
        buttons: new Collection(), selectMenus: new Collection(), modals: new Collection(),
        rest: { async put(route, { body }) {
            if (!body.length) return;
            assert.equal(body.length, 96);
            assert.ok(body.some(command => command.name === 'survey'));
            assert.ok(body.some(command => command.name === 'bugreport'));
            for (const name of ['level', 'rank', 'leaderboard', 'leveladd', 'levelremove', 'levelset']) {
                assert.equal(body.some(command => command.name === name), false, name);
            }
        } },
    };
    await loadCommands(client);
    assert.equal(client.commands.size, 96);
    await registerCommands(client, { clientId: userId });
    await loadInteractions(client);
    for (const name of ['submission', 'survey_admin', 'survey_submit']) assert.ok(client.buttons.has(name), name);
    for (const name of ['submission_form', 'survey_edit', 'survey_form']) assert.ok(client.modals.has(name), name);
    assert.ok(client.selectMenus.has('survey_choose'));
});
