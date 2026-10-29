import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, LabelBuilder,
    MessageFlags, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder,
    TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getGuildConfig, patchGuildConfig } from '../services/config/guildConfig.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import {
    buildSubmissionModal, buildSubmissionPanel, deliverSubmission, validateSubmissionChannel,
} from './submissions.js';

export const DEFAULT_SURVEY_QUESTIONS = [
    { label: 'First impression / overall experience?', required: true },
    { label: 'What features would you like added?', required: false },
    { label: 'What would you change or balance?', required: false },
    { label: 'What have you enjoyed? Anything else?', required: false },
];

export function assertSurveyAdmin(interaction, ownerId = interaction.user.id) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        throw createError('Survey permission denied', ErrorTypes.PERMISSION,
            'You need Manage Server permission to manage surveys.');
    }
    if (ownerId !== interaction.user.id) {
        throw createError('Survey dashboard belongs to another user', ErrorTypes.PERMISSION,
            'Open your own dashboard with /survey dashboard.');
    }
}

export function validateSurveyName(name) {
    if (!/^[a-z0-9-]{1,24}$/.test(name)) {
        throw createError('Invalid survey name', ErrorTypes.VALIDATION,
            'Use a survey name with 1-24 lowercase letters, numbers, or hyphens.');
    }
    return name;
}

export async function getSurveys(interaction) {
    return (await getGuildConfig(interaction.client, interaction.guildId)).surveys || {};
}

export function requireSurvey(surveys, name) {
    validateSurveyName(name);
    if (!Object.hasOwn(surveys, name)) {
        throw createError('Survey not found', ErrorTypes.CONFIGURATION,
            'That survey does not exist. Use /survey create first.');
    }
    return surveys[name];
}

export function parseSurveyQuestions(value) {
    const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const questions = lines.map(line => ({
        label: (line.startsWith('*') ? line.slice(1) : line).trim(),
        required: line.startsWith('*'),
    }));
    if (!questions.length || questions.length > 4 || questions.some(question => !question.label || question.label.length > 45)) {
        throw createError('Invalid survey questions', ErrorTypes.VALIDATION,
            'Enter 1-4 questions, one per line, each 1-45 characters (excluding the optional * prefix).');
    }
    return questions;
}

function surveyForm(survey) {
    return {
        title: survey.title,
        buttonLabel: 'Take Survey',
        description: survey.description,
        fields: survey.questions.map((question, index) => ({ ...question, id: `question_${index}` })),
    };
}

export function surveyEditor(mode, name, panelChannelId, reviewChannelId, survey) {
    const values = {
        title: survey?.title || 'Community Feedback',
        description: survey?.description || 'Share your impressions, feature ideas, and balance suggestions privately with staff.',
        questions: (survey?.questions || DEFAULT_SURVEY_QUESTIONS)
            .map(question => `${question.required ? '*' : ''}${question.label}`).join('\n'),
    };
    const modal = new ModalBuilder()
        .setCustomId(`survey_edit:${mode}:${name}:${panelChannelId}:${reviewChannelId}`)
        .setTitle(mode === 'create' ? 'Create Survey' : 'Edit Survey');
    for (const [id, label, maxLength] of [
        ['title', 'Survey title', 45],
        ['description', 'Description / instructions', 1000],
        ['questions', 'Questions: one per line, * means required', 1000],
    ]) {
        const component = new LabelBuilder().setLabel(label);
        if (id === 'questions') {
            component.setDescription('1-4 questions, max 45 characters each. Example: *How was your experience?');
        }
        modal.addLabelComponents(component.setTextInputComponent(new TextInputBuilder()
                .setCustomId(id)
                .setStyle(id === 'title' ? TextInputStyle.Short : TextInputStyle.Paragraph)
                .setMaxLength(maxLength)
                .setRequired(true)
                .setValue(values[id])));
    }
    return modal;
}

export function surveyDashboard(surveys, ownerId, selectedName) {
    const entries = Object.entries(surveys);
    const survey = selectedName ? requireSurvey(surveys, selectedName) : null;
    const embed = new EmbedBuilder({
        title: survey ? `Survey: ${selectedName}` : 'Survey Dashboard',
        description: survey
            ? `${survey.title}\n${survey.description}\n\n**Status:** ${survey.enabled ? 'Accepting responses' : 'Disabled / draft'}\n**Panel:** <#${survey.panelChannelId}>\n**Staff review:** <#${survey.reviewChannelId}>\n\n${survey.questions.map((question, index) => `${index + 1}. ${question.label}${question.required ? ' (required)' : ' (optional)'}`).join('\n')}`
            : `${entries.length}/25 surveys configured. Use /survey create to add one, then choose a survey below to edit, publish, or disable it.`,
        color: 0x5865F2,
    });
    const components = [];
    if (entries.length) {
        components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`survey_choose:${ownerId}`)
            .setPlaceholder('Choose a survey')
            .addOptions(entries.map(([name, entry]) => ({
                label: name, value: name, description: entry.title, default: name === selectedName,
            })))));
    }
    if (survey) {
        components.push(new ActionRowBuilder().addComponents(
            ...[
                ['edit', 'Edit Questions / Details', ButtonStyle.Primary],
                ['publish', 'Publish / Enable', ButtonStyle.Success],
                ['disable', 'Disable', ButtonStyle.Danger],
            ].map(([action, label, style]) => new ButtonBuilder()
                .setCustomId(`survey_admin:${action}:${selectedName}:${ownerId}`)
                .setLabel(label).setStyle(style)),
        ));
    }
    return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

export async function handleSurveyEdit(interaction, client, [mode, name, panelId, reviewId]) {
    assertSurveyAdmin(interaction);
    validateSurveyName(name);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!['create', 'edit'].includes(mode)) {
        throw createError('Unknown survey editor mode', ErrorTypes.VALIDATION, 'Please reopen the survey editor.');
    }
    const surveys = await getSurveys(interaction);
    const previous = mode === 'edit' ? requireSurvey(surveys, name) : null;
    if (mode === 'create' && (Object.hasOwn(surveys, name) || Object.keys(surveys).length >= 25)) {
        throw createError('Survey already exists or limit reached', ErrorTypes.VALIDATION,
            'Use a unique survey name. A server can have at most 25 surveys.');
    }
    const title = interaction.fields.getTextInputValue('title').trim();
    const description = interaction.fields.getTextInputValue('description').trim();
    const questions = parseSurveyQuestions(interaction.fields.getTextInputValue('questions'));
    if (!title || title.length > 45 || !description || description.length > 1000) {
        throw createError('Invalid survey details', ErrorTypes.VALIDATION,
            'Provide a title (1-45 characters) and description (1-1000 characters).');
    }
    if (panelId === reviewId) {
        throw createError('Survey channels overlap', ErrorTypes.VALIDATION, 'Use separate panel and staff review channels.');
    }
    const panel = await interaction.guild.channels.fetch(panelId, { force: true });
    const review = await interaction.guild.channels.fetch(reviewId, { force: true });
    await validateSubmissionChannel(interaction.guild, panel);
    await validateSubmissionChannel(interaction.guild, review, { privateReview: true });
    const survey = {
        title, description, questions, panelChannelId: panelId, reviewChannelId: reviewId,
        enabled: previous?.enabled ?? false, revision: interaction.id,
    };
    await patchGuildConfig(client, interaction.guildId, { surveys: { [name]: survey } });
    await interaction.editReply({
        content: mode === 'create' ? 'Survey saved as a draft. Publish it when ready.' : 'Survey updated. Publish again to post an updated panel.',
        ...surveyDashboard({ ...surveys, [name]: survey }, interaction.user.id, name),
    });
}

export async function changeSurveyStatus(interaction, name, action) {
    assertSurveyAdmin(interaction);
    const surveys = await getSurveys(interaction);
    const survey = requireSurvey(surveys, name);
    if (action === 'publish') {
        const panel = await interaction.guild.channels.fetch(survey.panelChannelId, { force: true });
        const review = await interaction.guild.channels.fetch(survey.reviewChannelId, { force: true });
        await validateSubmissionChannel(interaction.guild, panel);
        await validateSubmissionChannel(interaction.guild, review, { privateReview: true });
        await panel.send(buildSubmissionPanel(surveyForm(survey), `survey_submit:${name}`));
    } else if (action !== 'disable') {
        throw createError('Unknown survey action', ErrorTypes.VALIDATION, 'This survey action is not available.');
    }
    const updated = { ...survey, enabled: action === 'publish' };
    await patchGuildConfig(interaction.client, interaction.guildId, { surveys: { [name]: updated } });
    return { ...surveys, [name]: updated };
}

export async function handleSurveyAdminButton(interaction, client, [action, name, ownerId]) {
    assertSurveyAdmin(interaction, ownerId);
    if (action === 'edit') {
        const survey = requireSurvey(await getSurveys(interaction), name);
        return interaction.showModal(surveyEditor('edit', name, survey.panelChannelId, survey.reviewChannelId, survey));
    }
    await interaction.deferUpdate();
    const surveys = await changeSurveyStatus(interaction, name, action);
    return interaction.editReply({
        content: action === 'publish' ? 'Survey panel published; responses enabled.' : 'Survey disabled. Existing responses are preserved.',
        ...surveyDashboard(surveys, interaction.user.id, name),
    });
}

export async function handleSurveySelect(interaction, client, [ownerId]) {
    assertSurveyAdmin(interaction, ownerId);
    await interaction.deferUpdate();
    return interaction.editReply({
        content: null,
        ...surveyDashboard(await getSurveys(interaction), interaction.user.id, interaction.values[0]),
    });
}

async function activeSurvey(interaction, name) {
    if (!interaction.inGuild()) {
        throw createError('Survey outside guild', ErrorTypes.VALIDATION, 'Use this survey in a server.');
    }
    const survey = requireSurvey(await getSurveys(interaction), name);
    if (!survey.enabled || survey.panelChannelId !== interaction.channelId) {
        throw createError('Survey disabled or moved', ErrorTypes.CONFIGURATION,
            'This survey is not currently accepting responses here. Ask staff for the current panel.');
    }
    return survey;
}

export async function handleSurveyButton(interaction, client, [name]) {
    const survey = await activeSurvey(interaction, name);
    return interaction.showModal(buildSubmissionModal(surveyForm(survey), `survey_form:${name}:${survey.revision}`));
}

export async function handleSurveyForm(interaction, client, [name, revision]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const survey = await activeSurvey(interaction, name);
    if (survey.revision !== revision) {
        throw createError('Survey changed during response', ErrorTypes.VALIDATION,
            'Staff updated this survey while you were answering. Please reopen the form and submit the current questions.');
    }
    return deliverSubmission(interaction, survey, surveyForm(survey), `survey response (${name})`);
}
