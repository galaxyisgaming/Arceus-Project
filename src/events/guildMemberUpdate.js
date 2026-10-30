import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { getOnboardingConfig, beginOnboarding } from '../services/onboardingService.js';
import { notifyOnboardingStart } from '../handlers/onboarding.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;

      if (oldMember.pending === true && newMember.pending === false && !newMember.user.bot) {
        try {
          const config = await getOnboardingConfig(newMember.client, newMember.guild.id);
          if (config.enabled) {
            const record = await beginOnboarding(newMember.client, newMember);
            if (['awaiting_rules', 'questionnaire'].includes(record.status)) {
              await notifyOnboardingStart(newMember, config);
            }
          }
        } catch (error) {
          logger.error(`Cannot deliver onboarding instructions after Discord screening for ${newMember.id}:`, error);
        }
      }

      if (oldMember.nickname !== newMember.nickname) {
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            title: 'Nickname changed',
            lines: [
              `**User:** ${newMember.user.toString()} (${newMember.user.tag})`,
              `**ID:** \`${newMember.user.id}\``,
              `**Before:** ${oldMember.nickname || '*(no nickname)*'}`,
              `**After:** ${newMember.nickname || '*(no nickname)*'}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          }
        });

        return;
      }

    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  }
};