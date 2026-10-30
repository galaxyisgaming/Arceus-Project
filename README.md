# TitanBot - Ultimate Discord Bot

**TitanBot** is a powerful, feature-rich Discord bot designed to enhance your server experience with comprehensive moderation tools, engaging economy systems, utility features, and much more. Built with modern Discord.js v14 and PostgreSQL for optimal performance and data persistence.

[![Support Server](https://img.shields.io/badge/-Support%20Server-%235865F2?logo=discord&logoColor=white&style=flat-square&logoWidth=20)](https://discord.gg/8kJBYhTGW9)
[![Discord.js](https://img.shields.io/npm/v/discord.js?style=flat-square&labelColor=%23202225&color=%23202225&logo=npm&logoColor=white&logoWidth=20)](https://www.npmjs.com/package/discord.js)
![PostgreSQL](https://img.shields.io/badge/-PostgreSQL-%23336791?logo=postgresql&logoColor=white&style=flat-square&logoWidth=20)

## Table of Contents

Arceus commands are slash-only. Prefix messages such as `!shop`, `!help`,
`!play`, and custom guild prefixes do not execute commands or receive command
redirects. Use `/` to choose an Arceus command. Onboarding forms, buttons,
reaction roles, and counting remain active independently.
Legacy prefix configuration is retained for compatibility but does not enable
prefix dispatch.

Validate with `node --test scripts/message-commands.test.js scripts/onboarding.test.js scripts/reaction-roles.test.js`.

- [Features Overview](#features-overview)
- [Quick Setup](#quick-setup)
- [Manual Installation Steps](#manual-installation-steps)
- [Support Server](https://discord.gg/QnWNz2dKCE)
- [Required Bot Intents](#bot-intents)
- [Contributing](CONTRIBUTING.md)

<a name="features-overview"></a>
## Bug Reports and Feedback Surveys

There are two dedicated slash commands: **`/survey`** for administrators to create
and manage named surveys, and **`/bugreport`** for members to submit bugs.
Both support member-facing buttons, optional attachments, private staff review
messages, and confirmations visible only to the sender.

Administrators with **Manage Server** configure bug reporting once:

```text
/bugreport setup panel-channel:#bug-reports review-channel:#staff-bugs
```

Create these channels first. The review channel must explicitly deny **View
Channel** to `@everyone`; allow only the intended staff roles and Arceus. Arceus
needs View Channel, Send Messages and Embed Links in both channels, plus Attach
Files in the review channel. Member-facing and review channels must be different.
Review-channel privacy and bot permissions are checked again on every submission.

Members then use `/bugreport submit` from any server channel, or click the
published button. The form asks what went wrong, reproduction steps, expected
versus actual results, and optional platform/time details. Only administrators
can run `/bugreport setup` or `/bugreport disable`; submitting is open to members.

To create a survey:

```text
/survey create name:feedback panel-channel:#feedback review-channel:#staff-feedback
```

This opens an editor for the title, description, and **1-4 custom questions**.
Enter one question per line, up to 45 characters per question; prefix a question
with `*` to require an answer. The initial template asks about first impressions,
feature requests, changes/balance, and what members enjoyed. For example:

```text
*First impression? Rate 1-5 if you like.
What features would you like added?
What would you change or balance?
What have you enjoyed? Anything else?
```

Surveys start as **drafts**. Run `/survey dashboard` to select a survey and use
**Edit Questions / Details**, **Publish / Enable**, or **Disable**. You can also use:

```text
/survey edit name:feedback
/survey publish name:feedback
/survey disable name:feedback
```

`edit` also accepts optional `panel-channel` and `review-channel` settings. Run
`publish` after editing to post an updated panel. Existing buttons in the current
panel channel always open the current questions. If questions change while
someone is filling out a form, they must reopen it before submitting, so answers
cannot be attributed to different questions.

Each server can have up to **25 independent named surveys**. Names must contain
1-24 lowercase letters, numbers, or hyphens, such as `feedback` or `balance-test`.
All `/survey` commands and dashboard actions require Manage Server permission;
members answer through published buttons. Each answer accepts up to 1,000
characters. Optional questions can be skipped, but at least one answer is needed.

Both forms support up to three optional screenshots or other files, totaling
8 MiB. Files are re-uploaded into the staff review message, rather than stored as
temporary upload links. Submissions identify the sender to staff, but the
confirmation and report ID are visible only to the sender. These are **not
anonymous** surveys. Do not submit passwords or other sensitive information.

Settings use the existing guild configuration store; reports and attachments live
in Discord review messages and follow that channel's retention/deletion policy.
Use PostgreSQL in production so settings survive restarts. Buttons are registered
handlers, not temporary collectors, and continue working after restarts.
Re-running bug setup or publishing a survey posts a new button. Buttons in a
previous panel channel become inactive if its configured channel changes.
Disabling a flow stops both new and in-progress submissions without deleting
existing reports. Survey definitions and bug settings are independent.

### Leveling retired

The message-leveling system and `/level`, `/rank`, `/leaderboard`, `/leveladd`,
`/levelremove`, and `/levelset` commands have been removed. Arceus no longer awards
message XP, announces level-ups, or synchronizes level-reward roles on startup.
Previously stored leveling settings/XP and roles already earned are preserved;
leaving the server no longer deletes historical leveling records. Storage
compatibility and explicit `/wipedata` deletion remain available. No database
migration or data purge is required. Economy features are unchanged.

Removing those six commands and adding `/survey` and `/bugreport` leaves **96
top-level commands**, below Discord's 100-command limit. Restart/deploy Arceus to
replace its registered slash commands; removed commands may briefly remain in
Discord's cached command picker.

## Features Overview

TitanBot offers a complete suite of tools for Discord server management and community engagement:

<table>
<tr>
<td width="50%" valign="top">

### Moderation & Administration
- **Mass Actions** - Bulk ban/kick capabilities
- **User Notes** - Keep detailed moderation records
- **Case Management** - View and track all mod actions

### Economy System
- **Shop & Inventory** - Buy and manage items
- **Gambling** - Risk it for rewards
- **Pay System** - Transfer money between users

### Fun & Entertainment
- **Random Facts** - Learn something new
- **Wanted Poster** - Create fun wanted images
- **Text Reversal** - Reverse any text

### Advanced Ticket System
- **Claim & Priority** - Staff ticket management
- **Ticket Limits** - Prevent spam
- **Transcript System** - Save ticket history

### Server Stats
- **Member Counter** - Live member count channels
- **Voice Counters** - Track voice stats
- **Dynamic Updates** - Real-time channel updates

### Reaction Roles
- **Role Assignment** - Self-assignable roles
- **Emoji Selection** - Reaction-based system
- **Multi-role Support** - Multiple role options

Administrators create panels with `/reactroles setup` and manage them with
`/reactroles dashboard`. Members click the configured emoji reaction beside
a role to receive it, and remove their own reaction to remove that role. The
dashboard itself remains slash-command based.

Choose your own emojis with the optional `emoji1` through `emoji5` setup options,
matching `role1` through `role5`. Roles without a selection use the default
number/letter reactions. For an existing panel, including roles added through the
dashboard, use:

```text
/reactroles emoji panel:<choose your panel> role:@Role emoji:🎮
```

Paste one Unicode emoji or a custom emoji from this server (`<:name:id>`,
`<a:name:id>`, or its ID). Each role on the same panel must use a different emoji.
Only administrators can change mappings. The existing message and role grants
are preserved; old reactions for the changed emoji are cleared and the new
reaction and legend are published. Members can use the new reaction to add/remove
the role. Changing an emoji with existing member reactions requires Manage
Messages. If synchronization fails after saving, retry `/reactroles dashboard`.

Existing dropdown panels convert automatically on startup without removing any
member's existing roles. Emoji mappings persist across restarts and dashboard
edits. Opening the dashboard retries panel synchronization after a permission
issue. Old dropdown interactions on converted panels direct members to reactions.

The bot needs **Manage Roles**, **View Channel**, **Read Message History** and
**Add Reactions**, and its highest role must be above the roles being assigned.
**Manage Messages** is also needed when removing an option that members have
already reacted to; those reactions are cleared without removing their roles.
Managed, everyone and high-privilege roles cannot be self-assigned.

Discord permits **20 distinct reactions per message**. Create additional panels
for more roles. Older panels with more than 20 roles are left unconverted with an
explicit startup error; split their roles into smaller panels before restarting.
Role changes while the bot is offline are not replayed.

Run the focused checks with `node --test scripts/reaction-roles.test.js`.

### PokeGalaxy onboarding

Onboarding is **disabled by default**. It does not create/change Discord channels,
permissions, roles, webhooks or AutoMod rules, and does not remove existing members'
roles. Configure permissions deliberately before enabling it.

When enabled, new human members receive a DM linking to the existing onboarding
panel (for example in **#start-here**). If DMs are closed, Arceus mentions only
that member with instructions in the configured onboarding channel; answers and
age categories are never posted there. Members receive another prompt when
they finish Discord's native rules screening. Keep the onboarding channel visible
to newcomers and allow Arceus to send messages there.

Read the rules on the panel, then click **Start onboarding** once to open the
private questionnaire. Accepting the rules, appropriate chat and staff directions
is the final yes/no answer in the form, not a separate button. Discord does not
allow bots to open a form automatically on join. No access is granted just for
receiving a prompt or opening the form.

The flow is Start onboarding -> private five-field form with rules agreement -> automatic
approval or private staff review -> optional roles -> a link to the **existing**
PokeGalaxy welcome summary. The form asks invitation yes/no, optional inviter,
18+/under-18 category, interest and conduct agreement. Discord account age is read
automatically. No exact age or birthday is requested.

Accounts at least seven days old with recognized answers and accepted agreements
are automatically approved. Newer accounts and unclear answers require staff
review. Invitation status and adult/minor category alone do not reject anyone.
Conduct disagreement leaves access restricted. Staff can approve, decline, or
request corrected answers, with a required decision reason. Declining never kicks
or bans the member. Age category is self-reported, **not identity/age verification**.
All shared public channels must remain appropriate for minors; content filtering
and Discord age-restricted channels must be configured separately.

For the PokeGalaxy server, the supplied channel/verified-role/reviewer-role IDs
are built into disabled defaults. Saved dashboard settings take precedence over
defaults. All approved applicants receive only the verified role, regardless of
age category. Onboarding does not configure or check game channels, categories,
game bots or extra access roles. Obsolete saved settings are ignored; no database
migration is needed. Existing Discord channels and previously granted roles are
left unchanged.

Administrator commands:

- `/onboarding dashboard`: inspect settings.
- `/onboarding preapprove member:@user`: server owner only; personally vet a
  current member for this join. They still finish Discord screening, accept the
  current rules and submit a two-field age-category/rules-agreement form, but skip the full
  questionnaire and account-age review. It grants no roles by itself, cannot
  override a submitted/declined application, and does not survive rejoining.
  Typing "Galaxy" or "Hannah" as inviter never creates preapproval.
- `/onboarding configure`: save channel, verified-role, reviewer-role,
  welcome-message or rules-version settings while disabled.
- `/onboarding check`: validate setup without enabling it.
- `/onboarding rules`: publish/update Arceus's approved ten-rule message in the
  configured rules channel. It edits only its own saved message, not staff posts.
- `/onboarding panel`: post/update the member-facing screening panel.
- `/onboarding enable`: validate setup and the panel, then enable.
- `/onboarding disable`: stop onboarding without removing any member's roles.
  Legacy verification becomes available again if it is separately enabled.

Before enabling:

1. Let newcomers (`@everyone`) view rules and onboarding. Hide normal member areas
   until approval. Do not assign access-granting roles automatically on arrival.
2. Hide review, optional roles and welcome from `@everyone`.
   Only reviewer roles, administrators and Arceus should see the staff queue;
   member access roles must not expose it.
3. Give the verified role access to optional roles and welcome, and give the
   configured reviewer roles access to the private review queue.
4. Give Arceus Manage Roles, place its role above the verified role, and allow it
   to view/read all five configured channels and send/embed in onboarding/review.
5. Confirm the saved welcome message contains the intended summary embed. No
   webhook credentials are needed and the message is not reposted per applicant.
6. Audit **other** server roles/overwrites too: the checks validate the configured
   access paths, not every possible combined role a member might receive.

When enabled, join welcome/auto-role/auto-verification is replaced for human new
members. Legacy verify buttons and `/verify` direct them to screening. Access and
reviewer roles are reserved against grants through reaction panels, the legacy
application flow, shop and birthdays. Optional self-role assignment
requires approval. These checks do not override deliberate Discord staff actions.

Progress and decisions use persistent PostgreSQL storage, versioned rules
agreement, join-specific sessions, retryable role grants and serialized decisions
within one bot process. Run **one active Arceus replica**; multiple concurrent
instances require distributed coordination before use. Database degradation/read
errors block approval rather than using temporary memory. Pending/unfinished
records expire after 30 days and reviewed records after 14 days; granted roles
remain. Discord staff-review messages are separate and must be retained/deleted
according to the server's staff policy.

The saved bot-owned panel is refreshed in place on startup with the Start
onboarding button; old Begin / Check status buttons also open the new flow.
Review cards are restored after restart, and member status is available through
the onboarding panel even when DMs are closed. Clicking Start onboarding again
shows submitted, approved or declined status rather than creating another form.
Native Discord membership screening
must also be completed before the form opens. Forms expire if the rules version
changes or a member leaves and rejoins. Role selection is optional: the welcome button does not
require choosing any notification role. No PokeGalaxy economy/game data is edited.

#### Approved server rules and Discord setup

The Arceus panel and `/onboarding rules` share the same approved rule text.
Copy these ten entries into Discord's native Rules Screening too:

1. **Respect fellow trainers.** No harassment, hate speech, threats or discrimination.
2. **Keep content appropriate.** No explicit material, graphic content or harmful links.
3. **Protect privacy.** Never share someone's personal information, credentials or private messages without permission.
4. **Play fairly.** No self-bots, unauthorized automation, exploits or abuse of alternate accounts.
5. **Report bugs privately.** Don't repeatedly exploit errors or publicly share duplication methods.
6. **Keep trades honest.** No scams, impersonation, real-money sales or account trading.
7. **Use the correct channels.** Keep bot commands, support requests and feedback in their designated spaces.
8. **Avoid spam.** No flooding, unsolicited advertising or unnecessary mentions.
9. **Follow staff guidance and Discord's rules.** Appeal moderation decisions respectfully through the designated support route.
10. **Remember this is closed testing.** Features and balance may change; any planned progress resets should be announced beforehand.

In Discord Server Settings, enable Community if required, select the existing
rules channel, then configure Rules Screening (the UI may group it under
Safety Setup). Enable requiring members to accept the rules before talking.
In native Onboarding/Server Guide, make rules and the application channel easy
to find. Interest/notification questions must not grant Verified or reviewer
roles. Use an account with no staff/access roles
to test: administrators and manually verified members are not representative.

After checking the channel permissions above, run `/onboarding dashboard`,
`/onboarding check`, `/onboarding rules`, `/onboarding panel`, then
`/onboarding enable`. If updating an existing rules agreement, disable onboarding
and configure a new `rules-version` (for example `2026-10-29`) before publishing
and enabling again. Existing approved members keep their roles.
The dashboard's saved status, not the disabled source-code default, determines
whether onboarding is active. Enabling does not retroactively prompt yesterday's
joins; members without access can use the panel themselves. Existing Verified
members keep access and do not have to repeat screening.

Run local policy, UI, failure-path and regression checks:

```sh
node --test scripts/onboarding.test.js scripts/reaction-roles.test.js
```

These are mocked Discord/database integration tests, not a live-server acceptance
test. Before rollout, use a test member to exercise both approval routes, optional
roles and the welcome link.

</td>
<td width="50%" valign="top">

### Giveaways & Events
- **Multiple Winners** - Support multi-winner giveaways
- **Auto Picking** - Automatic winner selection
- **Reroll System** - Pick new winners if needed

### Birthday System
- **Birthday Tracking** - Never miss a birthday
- **Auto Announcements** - Celebrate automatically
- **Timezone Support** - Accurate worldwide tracking

### Utility Tools
- **Report System** - Report issues to staff
- **Todo Lists** - Personal task management
- **First Message** - Jump to channel's first message

### Welcome System
- **Welcome Messages** - Greet new members
- **Auto Roles** - Assign roles on join
- **Custom Embeds** - Personalized messages
  
### Music
- **24/7 Mode** - Play music 24/7
- **Interative Button System** - Manage music through buttons
- **Supports EVERY platform** - Supports spotify, deezer, youtube, apple music
  
</td>
</tr>
</table>

<a name="quick-setup"></a>
## Quick Setup (Recommended for non-coders)

### Video Tutorial
For a detailed step-by-step setup guide, watch our comprehensive video tutorial:
[**TitanBot Setup Tutorial**](https://www.youtube.com/@TouchDisc)

## Docker Deployment (Recommended)

TitanBot is fully containerized for easy deployment.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Set at minimum `DISCORD_TOKEN`, `CLIENT_ID`, and `GUILD_ID`. Docker Compose also reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from `.env` (defaults: `titanbot` / `password` / `titanbot`).

3. **Build and start the containers:**
   ```bash
   docker compose up -d --build
   ```

4. **Check status:**
   ```bash
   docker compose ps
   curl http://localhost:3000/health
   ```

This starts the bot and PostgreSQL. The compose file sets `POSTGRES_SSL=false` and `AUTO_MIGRATE=true` for the bundled database. Music uses public Lavalink v4 nodes from `lavalink/nodes.json` by default.

### Music

Music uses [Lavalink v4](https://github.com/lavalink-devs/Lavalink) via [Riffy](https://github.com/riffy-rb/riffy), similar to [Musicify](https://github.com/codebymitch/Musicify).

1. By default, the bot loads multiple public v4 SSL nodes from [`lavalink/nodes.json`](lavalink/nodes.json) (sourced from [lavalink.darrennathanael.com](https://lavalink.darrennathanael.com/SSL/Lavalink-SSL/)). Edit that file to add or remove nodes.
2. To self-host Lavalink instead, run `docker compose --profile local-lavalink up -d` and set single-node env vars in `.env`:
   ```env
   LAVALINK_HOST=lavalink
   LAVALINK_PORT=2333
   LAVALINK_PASSWORD=youshallnotpass
   LAVALINK_SECURE=false
   ```
   Remove or rename `lavalink/nodes.json` so the bot falls back to those env vars.
3. Override nodes inline with `LAVALINK_NODES` (JSON array) or point at another file with `LAVALINK_NODES_FILE`.
4. Use `/play <song>` from a voice channel, or `/join` to connect without playing. Commands are slash-only; music prefix shortcuts are disabled. Use `/nowplaying` and `/queue` for status; `/music` for loop, shuffle, seek, and other controls.

### Using GitHub Container Registry

The bot is automatically published to GitHub Container Registry on every push to main.

```bash
docker pull ghcr.io/codebymitch/titanbot:main
```

<a name="manual-installation-steps"></a>
## Manual Installation Steps

### Prerequisites
- Node.js 20.10.0 or higher
- PostgreSQL server (recommended) or memory storage fallback
- Discord bot application with proper intents

1. **Clone the Repository**
   ```bash
   git clone https://github.com/codebymitch/TitanBot.git
   cd TitanBot
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration (only the following variables require configuration, leave remaining variables as default):
   ```env
   # Discord Bot Configuration
   DISCORD_TOKEN=your_discord_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   GUILD_ID=your_discord_guild_id_here

   # PostgreSQL Configuration (Primary Database)
   POSTGRES_URL=postgresql://postgres:yourpassword@localhost:5432/titanbot
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_DB=titanbot
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=yourpassword
   ```

   Production note:
   - `NODE_ENV=production`
   - `LOG_LEVEL=warn` for a clean production console (critical issues + startup status)
   - `LOG_LEVEL=info` if you want more detailed operational logs
   - If your chosen `PORT` is already used, TitanBot automatically tries the next port(s)

   Environment options reference:
   - `NODE_ENV`: `development`, `production`, `test` (any non-`production` value is treated as non-production)
   - `LOG_LEVEL`: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly`
   - Accepted aliases for `LOG_LEVEL` in this bot: `warns`, `warning`, `warnings` → `warn`

   Recommended production `.env` (easy mode + default mode):
   ```env
   NODE_ENV=production
   LOG_LEVEL=warn
   WEB_HOST=0.0.0.0
   PORT=3000
   PORT_RETRY_ATTEMPTS=5
   ```
   This gives clear startup/online status messages while keeping logs simple for non-technical operators.
   If port `3000` is busy, the bot tries the next available ports automatically (up to `PORT_RETRY_ATTEMPTS`).

### Multiple servers

Slash commands are registered **globally** on startup (via `CLIENT_ID`), so the bot works in every server it is invited to. `GUILD_ID` stays in the tutorial `.env` for setup steps but is not used for command registration.

Notes:
- Global slash commands may take up to about an hour to propagate on first deploy
- Each server has **isolated** data: config, economy, tickets, surveys, dashboards, warnings, etc. (all keys are scoped as `guild:{guildId}:...`)
- In the [Discord Developer Portal](https://discord.com/developers/applications), ensure your bot is not restricted to a single guild if you plan to invite it elsewhere
- Generate an OAuth2 invite URL from the [Discord Developer Portal](https://discord.com/developers/applications) (OAuth2 → URL Generator, scopes: `bot` and `applications.commands`)

4. **Setup PostgreSQL Database** (Optional but recommended)
   ```bash
   # Create database and user
   createdb titanbot
   createuser titanbot
   psql -c "ALTER USER titanbot PASSWORD 'yourpassword';"
   psql -c "GRANT ALL PRIVILEGES ON DATABASE titanbot TO titanbot;"
   ```

5. **Verify Database Setup**
   ```bash
   npm run migrate:check
   ```

6. **Start the Bot**
   ```bash
   npm start
   ```

> **Note on database migrations:** Schema tables and legacy key migrations run
> **automatically on startup**, so` managed hosts like **Railway** need no manual
> migration step — just deploy/restart. To disable auto-migration set
> `AUTO_MIGRATE=false`. You can still run a manual key migration locally with
> `node scripts/migrate-keys.js --dry-run` (preview) or `node scripts/migrate-keys.js`.
<a name="bot-intents"></a>

## Required Bot Intents
TitanBot requires the following Discord intents:
- **Guilds**
- **Guild Messages**
- **Message Content**
- **Guild Members**
- **Guild Message Reactions**
- **Guild Voice States**
- **Direct Messages**
- **Bot**
- **Applications.commands**

### Required Permissions
- **View Channels**
- **Send Messages**
- **Embed Links**
- **Attach Files**
- **Read Message History**
- **Manage Messages**
- **Manage Channels**
- **Manage Roles**
- **Kick Members**
- **Manage Messages**
- **Ban Members**
- **Moderate Members**
- **Connect**

## License

TitanBot is released under the MIT License. See [LICENSE](LICENSE) for details.

## Thank You

Thank you for choosing TitanBot for your Discord server! We're constantly working to improve and add new features based on community feedback.

*Last updated: May 2026*
