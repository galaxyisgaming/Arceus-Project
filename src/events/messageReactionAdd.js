import { Events } from 'discord.js';
import { handleRoleReaction } from '../services/reactionRolePanels.js';

export default {
    name: Events.MessageReactionAdd,
    async execute(reaction, user) {
        await handleRoleReaction(reaction, user, true);
    },
};
