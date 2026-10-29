import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/events/messageCreate.js', import.meta.url), 'utf8');

function fixture({ counting = false } = {}) {
    const calls = { sends: 0, commands: 0, xp: 0, counts: 0, errors: [] };
    const context = {
        Events: { MessageCreate: 'messageCreate' },
        logger: { debug() {}, info() {}, error: (...args) => calls.errors.push(args) },
        getCountingGameConfig: async () => ({ enabled: counting, channelId: 'channel', lastUserId: null }),
        isValidCountingMessage: content => content === '1',
        recordCorrectCount: async () => { calls.counts++; },
        saveCountingGameConfig: async () => {},
        checkRateLimit: async () => true,
        getLevelingConfig: async () => ({ enabled: true, xpRange: { min: 15, max: 15 } }),
        getUserLevelData: async () => ({ lastMessage: 0 }),
        addXp: async (_client, _guild, _member, xp) => { calls.xp += xp; },
        setTimeout() { assert.fail('Unexpected counting failure'); }
    };
    const event = vm.runInNewContext(source
        .replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace('export default', 'const event =') + '\nevent;', context);
    const client = {
        commands: { get() { calls.commands++; return { execute() { calls.commands++; } }; } }
    };
    const message = {
        author: { id: 'user', tag: 'Trainer', bot: false }, guild: { id: 'guild' },
        member: {}, channel: { id: 'channel', async send() { calls.sends++; } },
        async reply() { calls.sends++; }, async delete() { assert.fail('Unexpected deletion'); }
    };
    return { event, calls, client, message };
}

test('Messages never dispatch prefix commands, send redirects or award retired leveling XP', async () => {
    for (const content of ['!shop', '!help', '!play song', '!sb 1', '!pause', '?help', '<@123> help', 'hello']) {
        const { event, calls, client, message } = fixture();
        await event.execute({ ...message, content }, client);
        assert.equal(calls.commands, 0, content);
        assert.equal(calls.sends, 0, content);
        assert.equal(calls.xp, 0, content);
        assert.deepEqual(calls.errors, [], content);
    }
});

test('Counting still processes valid counts independently of command dispatch', async () => {
    const { event, calls, client, message } = fixture({ counting: true });
    await event.execute({ ...message, content: '1' }, client);
    assert.equal(calls.counts, 1);
    assert.equal(calls.xp, 0);
    assert.equal(calls.commands, 0);
    assert.deepEqual(calls.errors, []);
});

test('Bot messages and DMs remain ignored', async () => {
    const { event, calls, client, message } = fixture();
    await event.execute({ ...message, content: '!help', author: { ...message.author, bot: true } }, client);
    await event.execute({ ...message, content: '!help', guild: null }, client);
    assert.equal(calls.commands, 0);
    assert.equal(calls.xp, 0);
    assert.equal(calls.sends, 0);
});

test('startup no longer synchronizes level roles or touches stored leveling records', async () => {
    const calls = { errors: [], sync: 0 };
    const summary = new Proxy({}, { get: () => 0 });
    const context = {
        Events: { ClientReady: 'clientReady' },
        config: { bot: { presence: {} } },
        logger: { error: (...args) => calls.errors.push(args) },
        startupLog() {},
        reconcileReactionRoleMessages: async () => summary,
        reconcileOnboarding: async () => {},
        reconcileTicketPanels: async () => summary,
        reconcileVerificationPanels: async () => summary,
        migrateReactionPanels: async () => {},
        reconcileReactionRolePanelHealth: async () => summary,
        reconcileLevelRoles: async () => { calls.sync++; },
    };
    const readySource = readFileSync(new URL('../src/events/ready.js', import.meta.url), 'utf8');
    const event = vm.runInNewContext(readySource
        .replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace('export default', 'const event =') + '\nevent;', context);
    await event.execute({
        user: { tag: 'Arceus', setPresence() {} },
        guilds: { cache: { size: 1 } }, commands: { size: 96 },
    });
    assert.equal(calls.sync, 0);
    assert.deepEqual(calls.errors, []);
});

test('member departure no longer deletes historical leveling data', async () => {
    const calls = { deleted: 0, errors: [] };
    const context = {
        Events: { GuildMemberRemove: 'guildMemberRemove' },
        logger: { debug() {}, error: (...args) => calls.errors.push(args) },
        getWelcomeConfig: async () => ({}),
        logEvent: async () => {},
        EVENT_TYPES: { MEMBER_LEAVE: 'member.leave' },
        getServerCounters: async () => [],
        getGuildBirthdays: async () => ({}),
        getUserApplications: async () => [],
        deleteUserLevelData: async () => { calls.deleted++; },
    };
    const leaveSource = readFileSync(new URL('../src/events/guildMemberRemove.js', import.meta.url), 'utf8');
    const event = vm.runInNewContext(leaveSource
        .replace(/^import[\s\S]*?;\r?\n/gm, '')
        .replace('export default', 'const event =') + '\nevent;', context);
    await event.execute({
        guild: { id: 'guild', memberCount: 1 }, client: {},
        user: { id: 'user', tag: 'Trainer', toString: () => '<@user>', displayAvatarURL: () => null },
    });
    assert.equal(calls.deleted, 0);
    assert.deepEqual(calls.errors, []);
});
