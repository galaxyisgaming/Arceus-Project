import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
    assertSurveyAdmin, changeSurveyStatus, getSurveys, requireSurvey,
    surveyDashboard, surveyEditor, validateSurveyName,
} from '../../handlers/surveys.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';

const nameOption = option => option.setName('name')
    .setDescription('Survey name: 1-24 lowercase letters, numbers, or hyphens')
    .setRequired(true).setMinLength(1).setMaxLength(24);
const existingNameOption = option => nameOption(option).setAutocomplete(true);
function channels(subcommand, required) {
    return subcommand
        .addChannelOption(option => option.setName('panel-channel')
            .setDescription('Member-facing text channel for the survey button')
            .addChannelTypes(ChannelType.GuildText).setRequired(required))
        .addChannelOption(option => option.setName('review-channel')
            .setDescription('Private staff text channel that receives responses')
            .addChannelTypes(ChannelType.GuildText).setRequired(required));
}

export default {
    data: new SlashCommandBuilder()
        .setName('survey')
        .setDescription('Create, edit, publish, and manage named community surveys')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand => channels(subcommand
            .setName('create').setDescription('Create a named survey with editable questions')
            .addStringOption(nameOption), true))
        .addSubcommand(subcommand => channels(subcommand
            .setName('edit').setDescription('Edit a survey title, description, questions, or channels')
            .addStringOption(existingNameOption), false))
        .addSubcommand(subcommand => subcommand
            .setName('dashboard').setDescription('Open the survey management dashboard')
            .addStringOption(option => option.setName('name').setDescription('Select a survey')
                .setAutocomplete(true).setRequired(false)))
        .addSubcommand(subcommand => subcommand
            .setName('publish').setDescription('Post a survey button and enable responses')
            .addStringOption(existingNameOption))
        .addSubcommand(subcommand => subcommand
            .setName('disable').setDescription('Stop accepting responses without deleting existing reports')
            .addStringOption(existingNameOption)),
    category: 'Community',
    slashOnly: true,

    async autocomplete(interaction) {
        assertSurveyAdmin(interaction);
        const query = interaction.options.getFocused().toLowerCase();
        const names = Object.keys(await getSurveys(interaction));
        return interaction.respond(names.filter(name => name.includes(query)).slice(0, 25).map(name => ({ name, value: name })));
    },

    async execute(interaction) {
        assertSurveyAdmin(interaction);
        const action = interaction.options.getSubcommand();
        const name = interaction.options.getString('name');
        if (action === 'create' || action === 'edit') {
            validateSurveyName(name);
            const surveys = await getSurveys(interaction);
            if (action === 'create' && (Object.hasOwn(surveys, name) || Object.keys(surveys).length >= 25)) {
                throw createError('Survey already exists or limit reached', ErrorTypes.VALIDATION,
                    'Use a unique survey name. A server can have at most 25 surveys.');
            }
            const survey = action === 'edit' ? requireSurvey(surveys, name) : null;
            const panelId = interaction.options.getChannel('panel-channel')?.id || survey?.panelChannelId;
            const reviewId = interaction.options.getChannel('review-channel')?.id || survey?.reviewChannelId;
            return interaction.showModal(surveyEditor(action, name, panelId, reviewId, survey));
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const surveys = action === 'dashboard'
            ? await getSurveys(interaction)
            : await changeSurveyStatus(interaction, name, action);
        return interaction.editReply({
            content: action === 'dashboard' ? null : action === 'publish'
                ? 'Survey panel published; responses enabled.' : 'Survey disabled. Existing responses are preserved.',
            ...surveyDashboard(surveys, interaction.user.id, name),
        });
    },
};
