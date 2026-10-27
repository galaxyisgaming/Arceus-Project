import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
    getOnboardingConfig, saveOnboardingConfig, validateOnboardingSetup,
} from '../../services/onboardingService.js';
import { onboardingPanel, onboardingError } from '../../handlers/onboarding.js';

const channelOptions = [
    ['application', 'Member-facing application channel'],
    ['rules', 'Rules agreement destination'],
    ['roles', 'Optional roles channel'],
    ['review', 'Private staff-review queue'],
    ['welcome', 'Existing PokeGalaxy welcome channel'],
    ['gameplay', 'Restricted shared gameplay channel'],
];

export default {
    data: new SlashCommandBuilder()
        .setName('onboarding').setDescription('Configure PokeGalaxy member onboarding')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('dashboard').setDescription('Show onboarding configuration and activation requirements'))
        .addSubcommand(sub => {
            sub.setName('configure').setDescription('Save onboarding destinations without changing Discord permissions');
            for (const [name, description] of channelOptions) {
                sub.addChannelOption(option => option.setName(`${name}-channel`).setDescription(description)
                    .addChannelTypes(ChannelType.GuildText));
            }
            return sub
                .addRoleOption(option => option.setName('verified-role').setDescription('Role granted after approval'))
                .addRoleOption(option => option.setName('gameplay-role').setDescription('Neutral access role for the restricted gameplay channel'))
                .addUserOption(option => option.setName('game-bot').setDescription('PokeGalaxy bot that must be able to use restricted gameplay'))
                .addChannelOption(option => option.setName('gameplay-category').setDescription('Parent category for restricted gameplay')
                    .addChannelTypes(ChannelType.GuildCategory))
                .addStringOption(option => option.setName('welcome-message').setDescription('Existing welcome summary message ID'))
                .addStringOption(option => option.setName('reviewer-roles').setDescription('Comma-separated reviewer role IDs'))
                .addStringOption(option => option.setName('rules-version').setDescription('Version of the rules members must accept'));
        })
        .addSubcommand(sub => sub.setName('check').setDescription('Validate channels, roles, privacy and welcome embed without enabling'))
        .addSubcommand(sub => sub.setName('panel').setDescription('Post or update the member-facing onboarding panel'))
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable onboarding after all configuration checks pass'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable onboarding; does not remove any member roles')),

    async execute(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
                throw new Error('Only server administrators may configure onboarding.');
            }
            const { client, guild } = interaction;
            const config = await getOnboardingConfig(client, guild.id);
            const action = interaction.options.getSubcommand();
            if (action === 'configure') {
                if (config.enabled) throw new Error('Disable onboarding before changing its configuration.');
                for (const [name] of channelOptions) {
                    const channel = interaction.options.getChannel(`${name}-channel`);
                    if (channel) config[`${name}ChannelId`] = channel.id;
                }
                for (const name of ['verified', 'gameplay']) {
                    const role = interaction.options.getRole(`${name}-role`);
                    if (role) config[`${name}RoleId`] = role.id;
                }
                const category = interaction.options.getChannel('gameplay-category');
                if (category) config.gameplayCategoryId = category.id;
                const gameBot = interaction.options.getUser('game-bot');
                if (gameBot) {
                    if (!gameBot.bot) throw new Error('Select the PokeGalaxy bot, not a member account.');
                    config.gameBotUserId = gameBot.id;
                }
                const messageId = interaction.options.getString('welcome-message');
                if (messageId) {
                    if (!/^\d{17,20}$/.test(messageId)) throw new Error('Enter a valid welcome message ID.');
                    config.welcomeMessageId = messageId;
                }
                const reviewers = interaction.options.getString('reviewer-roles');
                if (reviewers) {
                    const ids = [...new Set(reviewers.split(',').map(id => id.trim()))];
                    if (!ids.length || ids.some(id => !/^\d{17,20}$/.test(id))) throw new Error('Enter comma-separated reviewer role IDs.');
                    config.reviewerRoleIds = ids;
                }
                const version = interaction.options.getString('rules-version');
                if (version) config.rulesVersion = version.slice(0, 40);
                await saveOnboardingConfig(client, guild.id, config);
            } else if (['enable', 'check'].includes(action)) {
                await validateOnboardingSetup(client, guild, config);
                if (action === 'enable') {
                    if (!config.panelMessageId) throw new Error('Post the onboarding panel before enabling.');
                    const application = await guild.channels.fetch(config.applicationChannelId);
                    const panel = await application.messages.fetch(config.panelMessageId);
                    if (panel.author.id !== client.user.id) throw new Error('The saved onboarding panel is not owned by Arceus.');
                    config.enabled = true;
                    await saveOnboardingConfig(client, guild.id, config);
                }
            } else if (action === 'disable') {
                config.enabled = false;
                await saveOnboardingConfig(client, guild.id, config);
            } else if (action === 'panel') {
                const channel = await guild.channels.fetch(config.applicationChannelId);
                if (!channel || channel.type !== ChannelType.GuildText) throw new Error('Configure a text application channel.');
                const payload = onboardingPanel(config, guild.id);
                let message;
                if (config.panelMessageId) {
                    try {
                        message = await channel.messages.fetch(config.panelMessageId);
                    } catch (error) {
                        if (error.code !== 10008) throw error;
                    }
                }
                if (message) {
                    if (message.author.id !== client.user.id) throw new Error('The saved panel is not owned by Arceus.');
                    await message.edit(payload);
                } else {
                    message = await channel.send(payload);
                    config.panelMessageId = message.id;
                    await saveOnboardingConfig(client, guild.id, config);
                }
            }
            const fields = channelOptions.map(([name]) => ({
                name: `${name[0].toUpperCase()}${name.slice(1)} channel`,
                value: config[`${name}ChannelId`] ? `<#${config[`${name}ChannelId`]}>` : 'Not configured', inline: true,
            }));
            await interaction.editReply({
                content: action === 'check' ? 'Configuration checks passed. Onboarding has not been enabled.' : undefined,
                embeds: [new EmbedBuilder({
                    title: 'PokeGalaxy onboarding dashboard',
                    description: `Status: **${config.enabled ? 'Enabled' : 'Disabled'}**\n` +
                        'Rules agreement -> private screening -> approval/review -> optional roles -> PokeGalaxy welcome.\n\n' +
                        'No Discord permissions, channels, roles, webhooks or AutoMod rules are created/changed by these commands. ' +
                        'Existing members retain their roles. Enabling replaces legacy one-click/automatic verification for new members.',
                    fields: [...fields,
                        { name: 'Verified role', value: config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not configured', inline: true },
                        { name: 'Gameplay access role', value: config.gameplayRoleId ? `<@&${config.gameplayRoleId}>` : 'Not configured', inline: true },
                        { name: 'Reviewer roles', value: config.reviewerRoleIds.map(id => `<@&${id}>`).join(', ') || 'Not configured' },
                        { name: 'Next steps', value: 'Configure missing settings, check channel permissions, run `/onboarding check`, post `/onboarding panel`, then `/onboarding enable`.' },
                    ],
                    color: 0x9b59b6,
                })],
                allowedMentions: { parse: [] },
            });
        } catch (error) {
            await onboardingError(interaction, error);
        }
    },
};
