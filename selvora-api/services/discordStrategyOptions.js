const { version } = require('../package.json');

function discordStrategyOptions(env = process.env) {
  return {
    clientID: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    callbackURL: env.DISCORD_CALLBACK_URL,
    scope: ['identify', 'email'],
    // Discord requires a client URL and version, including for token/profile
    // requests. node-oauth's generic default can be rejected by Cloudflare.
    customHeaders: {
      'User-Agent': `DiscordBot (https://github.com/CarlBalansag/Profit-Tracker, ${version})`,
    },
  };
}

module.exports = { discordStrategyOptions };
