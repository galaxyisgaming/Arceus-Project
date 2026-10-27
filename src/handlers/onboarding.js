import {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags,
    ModalBuilder, TextInputBuilder, TextInputStyle, escapeMarkdown,
} from 'discord.js';
import {
    ADULT, MINOR, beginOnboarding, agreeToRules, getOnboardingConfig, getOnboardingMember,
    submitScreening, reviewOnboarding, isCurrentJoin, assertOnboardingMemberApproved,
    serializeOnboarding, saveReviewMessage,
} from '../services/onboardingService.js';
import { logger } from '../utils/logger.js';
import { getOnboardingMembersPrefix } from '../utils/database/keys.js';

const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const button = (action, label, style = ButtonStyle.Primary) => new ButtonBuilder()
    .setCustomId(`onboarding:${action}`).setLabel(label).setStyle(style);
const link = (label, guildId, channelId, messageId = '') => new ButtonBuilder()
    .setLabel(label).setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`);

export function onboardingPanel(config, guildId) {
    return {
        embeds: [new EmbedBuilder({
            title: 'Welcome to PokeGalaxy',
            description: 'Read the server rules, agree to them, then complete a short private screening form.\n\n' +
                'Accounts at least 7 days old with complete answers and accepted agreements can be approved automatically. ' +
                'Newer accounts or answers needing clarification go to authorized staff. ' +
                'After approval, choose optional roles and visit the PokeGalaxy welcome guide.\n\n' +
                'We ask only whether you are 18+ or under 18, never your birthday or exact age. ' +
                'Your answers are private to authorized staff. Do not enter other personal information.',
            color: 0x9b59b6,
        })],
        components: [row(link('Read the rules', guildId, config.rulesChannelId), button('start', 'Begin / Check status'))],
        allowedMentions: { parse: [] },
    };
}

export function onboardingStatusPayload(config, guildId, record) {
    const status = record?.status === 'questionnaire' && record.rulesVersion !== config.rulesVersion
        ? 'awaiting_rules' : record?.status || 'awaiting_rules';
    const payload = { components: [], allowedMentions: { parse: [] } };
    if (['approved', 'existing_member'].includes(status)) {
        payload.content = 'You are approved! First choose any optional roles, then continue to the PokeGalaxy welcome guide.';
        payload.components = [
            row(link('Choose optional roles', guildId, config.rolesChannelId), button('welcome', 'Continue to PokeGalaxy')),
        ];
        if (record?.answers?.ageGroup === MINOR) {
            payload.content += ` Your gameplay space is <#${config.gameplayChannelId}>.`;
        }
    } else if (status === 'declined') {
        payload.content = 'Your application was not approved. Your access remains restricted; contact staff to discuss your application. ' +
            'You have not been automatically kicked or banned.';
    } else if (status === 'pending_review') {
        payload.content = 'Your application is in the private staff-review queue. No need to resubmit. Check back here for your decision.';
    } else if (status === 'approving') {
        payload.content = 'Your approval is being completed. Use Retry to finish it; if it fails, contact staff.';
        payload.components = [row(button('retry', 'Retry approval'))];
    } else if (status === 'questionnaire') {
        payload.content = 'Your rules agreement is recorded. Complete the private screening form to continue.';
        payload.components = [row(button('form', 'Complete screening form'))];
    } else {
        payload.content = 'Read the server rules before continuing. Clicking “I agree to the rules” records your agreement.';
        payload.components = [row(link('Read the rules', guildId, config.rulesChannelId),
            button('agree', 'I agree to the rules', ButtonStyle.Success))];
    }
    return payload;
}

function input(id, label, placeholder, required = true, maxLength = 100) {
    return row(new TextInputBuilder().setCustomId(id).setLabel(label)
        .setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(maxLength).setPlaceholder(placeholder));
}

function screeningForm() {
    return new ModalBuilder().setCustomId('onboarding_form').setTitle('PokeGalaxy screening').addComponents(
        input('invited', 'Were you invited? Enter yes or no.', 'yes / no', true, 10),
        input('inviter', 'Inviter name (optional)', 'Leave blank if not invited or unknown', false),
        input('ageGroup', 'Are you 18+ or under 18?', '18+ / under 18 (no exact age or birthday)', true, 20),
        input('interest', 'What brings you here?', 'pokegalaxy / community / both / other', true, 100),
        input('conduct', 'Appropriate chat and staff directions: agree?', 'Enter yes to agree, or no to stop', true, 10),
    );
}

export function reviewCard(userId, record) {
    const safe = value => escapeMarkdown(String(value || 'Not provided')).replace(/@/g, '@\u200B');
    const decided = !['pending_review', 'approving'].includes(record.status);
    return {
        embeds: [new EmbedBuilder({
            title: `PokeGalaxy onboarding - ${record.status}`,
            description: `Applicant: <@${userId}> (\`${userId}\`)\n` +
                `Account created: <t:${Math.floor(record.accountCreatedAt / 1000)}:F>\n` +
                `Rules agreed: <t:${Math.floor(record.agreedAt / 1000)}:F> (version ${record.rulesVersion})`,
            color: decided ? 0x7289da : 0xf1c40f,
            fields: [
                { name: 'Invited?', value: safe(record.answers.invited), inline: true },
                { name: 'Inviter (self-reported)', value: safe(record.answers.inviter), inline: true },
                { name: 'Age category (self-reported; staff only)', value: safe(record.answers.ageGroup) },
                { name: 'Interest', value: safe(record.answers.interest), inline: true },
                { name: 'Conduct agreement', value: safe(record.answers.conduct), inline: true },
                { name: 'Why review is needed', value: record.reviewReasons?.length ? record.reviewReasons.join('\n') : 'Approval needs completion.' },
                ...(record.reviewedBy ? [{ name: 'Decision', value: `${safe(record.reviewedBy)}: ${safe(record.decisionReason || 'Automatic policy')}` }] : []),
            ],
        })],
        components: decided ? [] : [row(
            button(`approve:${userId}:${record.id}`, 'Approve', ButtonStyle.Success),
            button(`decline:${userId}:${record.id}`, 'Decline', ButtonStyle.Danger),
            button(`correct:${userId}:${record.id}`, 'Request correction', ButtonStyle.Secondary),
        )],
        allowedMentions: { parse: [] },
    };
}

export async function ensureReviewCard(client, guild, userId) {
    return serializeOnboarding(guild.id, userId, async () => {
        const record = await getOnboardingMember(client, guild.id, userId);
        if (!record || !['pending_review', 'approving'].includes(record.status)) return;
        const config = await getOnboardingConfig(client, guild.id);
        if (!config.enabled) return;
        const applicant = await guild.members.fetch({ user: userId, force: true });
        if (!isCurrentJoin(record, applicant)) return;
        const channel = await guild.channels.fetch(config.reviewChannelId);
        if (record.reviewMessageId && record.reviewChannelId === channel.id) {
            try {
                const message = await channel.messages.fetch(record.reviewMessageId);
                // A correction/resubmission uses a new nonce, so never reuse stale review controls.
                if (message.components?.some(component => component.components?.some(entry =>
                    entry.customId?.endsWith(`:${record.id}`)))) return;
            } catch (error) {
                if (error.code !== 10008) throw error;
            }
        }
        const message = await channel.send({
            ...reviewCard(userId, record), nonce: record.id.replace(/-/g, '').slice(0, 25), enforceNonce: true,
        });
        await saveReviewMessage(client, guild.id, userId, record, channel.id, message.id);
    });
}

async function freshMember(interaction) {
    if (!interaction.guild) throw new Error('Use onboarding inside the server.');
    return interaction.guild.members.fetch({ user: interaction.user.id, force: true });
}

async function refreshDecisionCard(client, guild, userId, record) {
    if (!record.reviewMessageId) return;
    try {
        const channel = await guild.channels.fetch(record.reviewChannelId);
        const message = await channel.messages.fetch(record.reviewMessageId);
        await message.edit(reviewCard(userId, record));
    } catch (error) {
        logger.warn(`Onboarding decision saved but review card ${record.reviewMessageId} could not be updated:`, error);
    }
}

async function notifyDecision(member, config, record) {
    try {
        const payload = onboardingStatusPayload(config, member.guild.id, record);
        await member.send({ ...payload,
            content: `${payload.content}\nCheck your status or continue in <#${config.applicationChannelId}>.`,
            components: payload.components.filter(component => component.components.every(entry => entry.data.style === ButtonStyle.Link)),
        });
    } catch (error) {
        logger.warn(`Onboarding decision DM could not be delivered to ${member.id}; status remains available in the onboarding channel:`, error);
    }
}

export async function handleOnboardingButton(interaction, client, args) {
    const [action, userId, recordId] = args;
    try {
        if (['approve', 'decline', 'correct'].includes(action)) {
            const config = await getOnboardingConfig(client, interaction.guildId);
            const reviewer = await freshMember(interaction);
            if (interaction.channelId !== config.reviewChannelId ||
                !config.reviewerRoleIds.some(id => reviewer.roles.cache.has(id))) {
                throw new Error('Use the private review queue with an authorized reviewer role.');
            }
            await interaction.showModal(new ModalBuilder().setCustomId(`onboarding_review:${action}:${userId}:${recordId}`)
                .setTitle(action === 'approve' ? 'Approve application' : action === 'decline' ? 'Decline application' : 'Request correction')
                .addComponents(input('reason', 'Reason for this decision (staff only)', 'Required audit reason', true, 500)));
            return;
        }
        if (action === 'form') {
            const member = await freshMember(interaction);
            const config = await getOnboardingConfig(client, interaction.guildId);
            const record = await getOnboardingMember(client, interaction.guildId, member.id);
            if (!config.enabled || !isCurrentJoin(record, member) || record.status !== 'questionnaire' ||
                record.rulesVersion !== config.rulesVersion) throw new Error('Start onboarding and agree to the current rules first.');
            await interaction.showModal(screeningForm());
            return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await freshMember(interaction);
        const config = await getOnboardingConfig(client, interaction.guildId);
        if (action === 'welcome') {
            await assertOnboardingMemberApproved(client, member);
            const record = await getOnboardingMember(client, interaction.guildId, member.id);
            await interaction.editReply({
                content: `Welcome to PokeGalaxy! Read the guide below.${record?.answers?.ageGroup === MINOR ? ` Play in <#${config.gameplayChannelId}>.` : ''}`,
                components: [row(link('PokeGalaxy welcome guide', interaction.guildId, config.welcomeChannelId, config.welcomeMessageId))],
                allowedMentions: { parse: [] },
            });
            return;
        }
        let record;
        if (action === 'agree') record = await agreeToRules(client, member);
        else if (action === 'retry') record = await submitScreening(client, member, {});
        else if (action === 'start') record = await beginOnboarding(client, member);
        else throw new Error('Unknown onboarding action.');
        if (['pending_review', 'approving'].includes(record.status)) await ensureReviewCard(client, member.guild, member.id);
        await interaction.editReply(onboardingStatusPayload(config, member.guild.id, record));
    } catch (error) {
        await onboardingError(interaction, error);
    }
}

export async function handleOnboardingForm(interaction, client) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = await freshMember(interaction);
        const answers = Object.fromEntries(['invited', 'inviter', 'ageGroup', 'interest', 'conduct']
            .map(id => [id, interaction.fields.getTextInputValue(id)]));
        const record = await submitScreening(client, member, answers);
        const config = await getOnboardingConfig(client, member.guild.id);
        if (['pending_review', 'approving'].includes(record.status)) await ensureReviewCard(client, member.guild, member.id);
        if (record.status === 'approved') await refreshDecisionCard(client, member.guild, member.id, record);
        await interaction.editReply(onboardingStatusPayload(config, member.guild.id, record));
    } catch (error) {
        await onboardingError(interaction, error);
    }
}

export async function handleOnboardingReview(interaction, client, args) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const [action, userId, recordId] = args;
        const config = await getOnboardingConfig(client, interaction.guildId);
        if (interaction.channelId !== config.reviewChannelId) throw new Error('Submit decisions in the private review queue.');
        const reviewer = await freshMember(interaction);
        const record = await reviewOnboarding(client, reviewer, userId, recordId, action, interaction.fields.getTextInputValue('reason'));
        const oldRecord = { ...record, reviewMessageId: record.reviewMessageId || interaction.message?.id,
            reviewChannelId: config.reviewChannelId };
        await refreshDecisionCard(client, reviewer.guild, userId, oldRecord);
        const member = await reviewer.guild.members.fetch({ user: userId, force: true });
        await notifyDecision(member, config, record);
        await interaction.editReply({ content: `Application ${record.status}. The decision has been saved.`, allowedMentions: { parse: [] } });
    } catch (error) {
        await onboardingError(interaction, error);
    }
}

export async function reconcileOnboarding(client) {
    for (const guild of client.guilds.cache.values()) {
        try {
            const config = await getOnboardingConfig(client, guild.id);
            if (!config.enabled) continue;
            const keys = await client.db.list(getOnboardingMembersPrefix(guild.id));
            if (!Array.isArray(keys)) throw new Error('Cannot list saved onboarding records.');
            for (const key of keys) {
                try {
                    await ensureReviewCard(client, guild, key.split(':').at(-1));
                } catch (error) {
                    logger.error(`Cannot restore onboarding review card for ${key}:`, error);
                }
            }
        } catch (error) {
            logger.error(`Cannot restore onboarding for guild ${guild.id}:`, error);
        }
    }
}

export async function onboardingError(interaction, error) {
    logger.error(`Onboarding action failed in ${interaction.guildId} for ${interaction.user?.id}:`, error);
    const payload = { content: `Onboarding could not complete: ${error.message}`, components: [], allowedMentions: { parse: [] } };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}
