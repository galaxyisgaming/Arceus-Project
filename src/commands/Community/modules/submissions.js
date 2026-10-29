import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandSubcommandGroupBuilder } from 'discord.js';
import { patchGuildConfig } from '../../../services/config/guildConfig.js';
import { submissionPanel, validateSubmissionChannel } from '../../../handlers/submissions.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';

const typeOption = option => option
    .setName('type')
    .setDescription('Which submission flow to configure')
    .setRequired(true)
    .addChoices({ name: 'Bug reports', value: 'bug' }, { name: 'Feedback survey', value: 'feedback' });

export default {
    data: new SlashCommandSubcommandGroupBuilder()
        .setName('submissions')
        .setDescription('Set up private bug reports and community feedback')
        .addSubcommand(subcommand => subcommand
            .setName('setup')
            .setDescription('Configure channels and publish a submission button')
            .addStringOption(typeOption)
            .addChannelOption(option => option
                .setName('panel-channel')
                .setDescription('Member-facing channel for the button')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addChannelOption(option => option
                .setName('review-channel')
                .setDescription('Existing private staff channel that receives submissions')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('disable')
            .setDescription('Stop accepting this type of submission')
            .addStringOption(typeOption)),
    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            throw createError('Submission setup permission denied', ErrorTypes.PERMISSION,
                'You need Manage Server permission to configure submissions.');
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const type = interaction.options.getString('type', true);
        if (interaction.options.getSubcommand() === 'disable') {
            await patchGuildConfig(interaction.client, interaction.guildId, { submissions: { [type]: null } });
            await interaction.editReply({ content: 'Submissions disabled. Existing buttons will no longer open this form.' });
            return;
        }
        const panel = interaction.options.getChannel('panel-channel', true);
        const review = interaction.options.getChannel('review-channel', true);
        if (panel.id === review.id) {
            throw createError('Submission channels overlap', ErrorTypes.VALIDATION,
                'Use separate member-facing and staff review channels.');
        }
        await validateSubmissionChannel(interaction.guild, panel);
        await validateSubmissionChannel(interaction.guild, review, { privateReview: true });
        await patchGuildConfig(interaction.client, interaction.guildId, {
            submissions: { [type]: { panelChannelId: panel.id, reviewChannelId: review.id } },
        });
        await panel.send(submissionPanel(type));
        await interaction.editReply({
            content: `Submission button posted in <#${panel.id}>. Reports will go to <#${review.id}>. Ensure only staff roles and Arceus can view the review channel.`,
            allowedMentions: { parse: [] },
        });
    },
};
