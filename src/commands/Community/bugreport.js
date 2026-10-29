import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { patchGuildConfig } from '../../services/config/guildConfig.js';
import { activeBugConfig, submissionModal, submissionPanel, validateSubmissionChannel } from '../../handlers/submissions.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';

export default {
    data: new SlashCommandBuilder()
        .setName('bugreport')
        .setDescription('Submit a private bug report, or configure bug reporting')
        .setDMPermission(false)
        .addSubcommand(subcommand => subcommand
            .setName('submit')
            .setDescription('Report a bug privately to staff with optional attachments'))
        .addSubcommand(subcommand => subcommand
            .setName('setup')
            .setDescription('Admins: configure channels and publish the bug report button')
            .addChannelOption(option => option
                .setName('panel-channel')
                .setDescription('Member-facing channel for the button')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true))
            .addChannelOption(option => option
                .setName('review-channel')
                .setDescription('Private staff text channel that receives bug reports')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)))
        .addSubcommand(subcommand => subcommand
            .setName('disable')
            .setDescription('Admins: stop accepting bug reports')),
    category: 'Community',
    slashOnly: true,

    async execute(interaction) {
        if (!interaction.inGuild()) {
            throw createError('Bug report outside guild', ErrorTypes.VALIDATION, 'Use this command in a server.');
        }
        if (interaction.options.getSubcommand() === 'submit') {
            await activeBugConfig(interaction, interaction.client);
            return interaction.showModal(submissionModal('bug', 'direct'));
        }
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
            throw createError('Bug report setup permission denied', ErrorTypes.PERMISSION,
                'You need Manage Server permission to configure bug reports.');
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (interaction.options.getSubcommand() === 'disable') {
            await patchGuildConfig(interaction.client, interaction.guildId, { submissions: { bug: null } });
            return interaction.editReply({ content: 'Bug reports disabled. Existing reports have not been deleted.' });
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
            submissions: { bug: { panelChannelId: panel.id, reviewChannelId: review.id } },
        });
        await panel.send(submissionPanel('bug'));
        return interaction.editReply({
            content: `Bug report button posted in <#${panel.id}>. Reports go to <#${review.id}>. Members can also use /bugreport submit. Ensure only staff and Arceus can view the review channel.`,
            allowedMentions: { parse: [] },
        });
    },
};
