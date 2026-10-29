import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
    FileUploadBuilder, LabelBuilder, MessageFlags, ModalBuilder,
    PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const SUBMISSION_FORMS = {
    bug: {
        title: 'Submit Bug Report',
        description: 'Report a problem privately to staff. Include what happened and how to reproduce it.',
        fields: [
            { id: 'summary', label: 'What went wrong?', placeholder: 'A short description of the problem', required: true },
            { id: 'steps', label: 'How can we reproduce it?', placeholder: 'List the steps leading up to the problem', required: true },
            { id: 'outcome', label: 'Expected vs. actual result', placeholder: 'What should happen? What happened instead?', required: true },
            { id: 'environment', label: 'Where and when? (optional)', placeholder: 'Feature, device/platform, approximate time', required: false },
        ],
    },
    feedback: {
        title: 'Submit Feedback',
        description: 'Share your impressions, feature ideas, or balance suggestions privately with staff.',
        fields: [
            { id: 'impression', label: 'First impression / overall experience', placeholder: 'Rate 1-5 if you like. What have you enjoyed most?', required: true },
            { id: 'features', label: 'What features would you like added?', placeholder: 'New features or functions you would find useful', required: false },
            { id: 'balance', label: 'What would you change or balance?', placeholder: 'Too strong, too weak, unfair, or confusing? Why?', required: false },
            { id: 'other', label: 'Anything else? (optional)', placeholder: 'You can leave the other optional questions blank.', required: false },
        ],
    },
};

function formFor(type) {
    const form = Object.hasOwn(SUBMISSION_FORMS, type) ? SUBMISSION_FORMS[type] : null;
    if (!form) {
        throw createError('Unknown submission type', ErrorTypes.VALIDATION, 'This submission form is not available.');
    }
    return form;
}

export function submissionPanel(type) {
    const form = formFor(type);
    return {
        embeds: [new EmbedBuilder()
            .setTitle(form.title)
            .setDescription(`${form.description}\n\nScreenshots or other files are optional (up to 3 files, 8 MiB total). Please do not include passwords or other sensitive information.`)
            .setColor(type === 'bug' ? 0xED4245 : 0x5865F2)],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`submission:${type}`)
                .setLabel(form.title)
                .setStyle(ButtonStyle.Primary),
        )],
        allowedMentions: { parse: [] },
    };
}

export function submissionModal(type) {
    const form = formFor(type);
    const modal = new ModalBuilder()
        .setCustomId(`submission_form:${type}`)
        .setTitle(form.title);
    for (const field of form.fields) {
        modal.addLabelComponents(new LabelBuilder()
            .setLabel(field.label)
            .setTextInputComponent(new TextInputBuilder()
                .setCustomId(field.id)
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(field.placeholder)
                .setMaxLength(1000)
                .setRequired(field.required)));
    }
    return modal.addLabelComponents(new LabelBuilder()
        .setLabel('Screenshots / attachments (optional)')
        .setDescription('Up to 3 files, 8 MiB total. Do not upload secrets.')
        .setFileUploadComponent(new FileUploadBuilder()
            .setCustomId('attachments')
            .setRequired(false)
            .setMaxValues(3)));
}

export async function validateSubmissionChannel(guild, channel, { privateReview = false } = {}) {
    if (!channel || channel.guildId !== guild.id || channel.type !== ChannelType.GuildText) {
        throw createError('Invalid submission channel', ErrorTypes.CONFIGURATION, 'Select an existing text channel in this server.');
    }
    const me = await guild.members.fetchMe();
    const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    if (privateReview) required.push(PermissionFlagsBits.AttachFiles);
    if (!channel.permissionsFor(me)?.has(required)) {
        throw createError('Missing submission channel permissions', ErrorTypes.PERMISSION,
            'Arceus needs View Channel, Send Messages, Embed Links, and (in the review channel) Attach Files permissions.');
    }
    if (privateReview && !channel.permissionOverwrites.cache.get(guild.id)?.deny.has(PermissionFlagsBits.ViewChannel)) {
        throw createError('Review channel is not private', ErrorTypes.CONFIGURATION,
            'The review channel must deny View Channel to @everyone. Allow access only to staff and Arceus.');
    }
    return channel;
}

async function activeConfig(interaction, client, type) {
    formFor(type);
    if (!interaction.inGuild()) {
        throw createError('Submission outside guild', ErrorTypes.VALIDATION, 'Use this form in a server.');
    }
    const config = (await getGuildConfig(client, interaction.guildId)).submissions?.[type];
    if (!config || config.panelChannelId !== interaction.channelId) {
        throw createError('Submission panel disabled or moved', ErrorTypes.CONFIGURATION,
            'This submission panel is no longer active. Ask staff for the current panel.');
    }
    return config;
}

export async function handleSubmissionButton(interaction, client, [type]) {
    await activeConfig(interaction, client, type);
    await interaction.showModal(submissionModal(type));
}

export async function handleSubmissionForm(interaction, client, [type]) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await activeConfig(interaction, client, type);
    const form = formFor(type);
    const fields = form.fields.map(field => {
        const value = interaction.fields.getTextInputValue(field.id).trim();
        if ((field.required && !value) || value.length > 1000) {
            throw createError('Invalid submission answer', ErrorTypes.VALIDATION,
                `Please answer "${field.label}" using 1-1000 characters.`);
        }
        return { name: field.label, value };
    }).filter(field => field.value);
    const attachments = [...(interaction.fields.getUploadedFiles('attachments')?.values() ?? [])];
    if (attachments.length > 3 || attachments.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_BYTES) {
        throw createError('Submission attachments too large', ErrorTypes.VALIDATION,
            'Please submit up to 3 attachments totaling no more than 8 MiB.');
    }
    const channel = await interaction.guild.channels.fetch(config.reviewChannelId, { force: true });
    await validateSubmissionChannel(interaction.guild, channel, { privateReview: true });

    // Re-upload files so the review does not depend on expiring modal attachment URLs.
    const message = await channel.send({
        embeds: [new EmbedBuilder({
            title: type === 'bug' ? 'Bug Report' : 'Community Feedback',
            description: `Submitted by <@${interaction.user.id}> (ID: ${interaction.user.id})`,
            fields,
            footer: { text: `Report ID: ${interaction.id}` },
            timestamp: new Date().toISOString(),
            color: type === 'bug' ? 0xED4245 : 0x5865F2,
        })],
        files: attachments.map(file => ({ attachment: file.url, name: file.name })),
        allowedMentions: { parse: [] },
        enforceNonce: true,
        nonce: interaction.id,
    });
    await interaction.editReply({
        content: `Thank you! Your ${type === 'bug' ? 'bug report' : 'feedback'} was sent privately to staff.\nReport ID: ${interaction.id}`,
        allowedMentions: { parse: [] },
    });
    return message;
}
