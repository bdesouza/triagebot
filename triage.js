const DEFAULTS = require('./settings.json');


/**
 * Create a triage report
 *
 * @param {Object} payload - The Slack slash command payload
 * @param {Object[]} message - The Slack message history
 * @param {Object} options - (optional) settings overrides
 * @returns {Object} The Slack triage report message
 */
function create(payload, messages, options) {
  let settings = Object.assign({}, DEFAULTS, options);

  let map = getRequest.bind(null, settings);
  let sort = (a, b) => a.priority - b.priority;
  let filter = m => m.emoji && !m.bot && !m.message.bot_id && (m.message.subtype && m.message.subtype.includes("reminder") ? !1 : !0);

  let requests = messages.map(map).filter(filter).sort(sort);
  let message = buildMessage(payload, requests, settings);
  
  return message;
}


/**
 * Get triage request details from a Slack message and the associated reactions.
 *
 * @param {Object} settings - The triage report settings
 * @param {Object} message - A Slack message
 * @returns {Object} A triage object
 */
function getRequest(settings, message) {
  //reactions
  let reactions = (message.reactions || []).map(r => r.name);

  // determine priority and emoji
  let pending_emoji_list = Array.prototype.concat(settings.pending.emojis.urgent, settings.pending.emojis.high, settings.pending.emojis.low);

  let urgent_test = new RegExp(settings.pending.emojis.urgent.join('|'));
  let high_test = new RegExp(settings.pending.emojis.high.join('|'));
  let low_test = new RegExp(settings.pending.emojis.low.join('|'));

  let emoji = message.text.match(urgent_test) ? settings.pending.emojis.urgent[0] :
      (message.text.match(high_test) ? settings.pending.emojis.high[0] :
          (message.text.match(low_test) ? settings.pending.emojis.low[0] : null));


  let reaction_match = pending_emoji_list.some(e => reactions.includes(e));

  // if there is a reaction, look at it
  if (reaction_match) {
    let reaction_text = reactions.join('|');
    emoji = reaction_text.match(urgent_test) ? settings.pending.emojis.urgent[0] :
        (reaction_text.match(high_test) ? settings.pending.emojis.high[0] :
            (reaction_text.match(low_test) ? settings.pending.emojis.low[0] : null));
  }

  // flags based on reactions
  let addressed = settings.addressed.emojis.some(e => reactions.includes(e));
  let review = settings.review.emojis.some(e => reactions.includes(e)) && !addressed; 
  let pending = emoji && !review && !addressed;

  let id = message.ts.replace('.', '');                                 // deep link id
  let bot = message.subtype === 'bot_message';                          // bot posts
  let priority = pending_emoji_list.indexOf(emoji);                     // display order

  return { bot, priority, emoji, review, addressed, pending, id, message };
}


/**
 * Build a Slack triage response
 *
 * @param {Object} settings - The triage report settings
 * @param {Object} payload - The Slack slash command payload
 * @param {Object[]} requests - The triage request details 
 * @returns {Object} The Slack triage report message
 */
function buildMessage(payload, requests, settings) {
  let {channel_id, channel_name} = payload;
  let message = { unfurl_links: settings.unfurl_links };

  let publish_test = new RegExp(settings.publish_text, 'i');
  let list_test = new RegExp(settings.publish_text, 'i');
  let help_test  = new RegExp(settings.help_text, 'i');

  // create help text and return
  if (help_test.test(payload.text)) {
    message.attachments = settings.help;
    return message;
  }

  // build display text
  let map = buildSection.bind(null, settings, requests, payload);
  message.text = settings.display.map(map).join('\n\n\n');

  // attach instructions if not publish else make public
  if (publish_test.test(payload.text)) message.response_type = 'in_channel';
  else message.attachments = settings.list;
    
  return message;
}


/**
 * Build a triage section's text
 *
 * @param {String} name - The section name
 * @param {Object} settings - The triage report settings
 * @param {Object[]} requests - The triage request details 
 * @param {Object} payload - The Slack slash command payload
 * @returns {String} The section text
 */
function buildSection(settings, requests, payload, name) {
  let {channel_id, channel_name, team_domain} = payload;
  let baseUrl = `https://${team_domain}.slack.com/archives/${channel_name}/p`;

  let {title} = settings[name];                                                                           // section title
  let filtered = requests.filter(r => r[name]);                                                           // filtered list of requests
  let items = filtered.map(r => `:${r.emoji}: ${baseUrl + r.id} ${buildAttributeString(settings,r)}`);    // section line item
  let text = [title].concat(items).join('\n');                                                            // combined text

  // replace template fields
  text = text.replace(/{{count}}/g, filtered.length);
  text = text.replace(/{{channel}}/g, `<#${channel_id}|${channel_name}>`);

  return text;
}

/**
 * Build attributor for a section
 *
 * @param {Object} request - The request
 */
function buildAttributeString(settings,request) {
  if(settings.display_user_attributes.includes('pending') && request.pending) {
    return `<@${request.message.user}>`
  }

  if(settings.display_user_attributes.includes('addressed') && request.addressed) {
    return `<@${request.message.user}>`
  }

  if(settings.display_user_attributes.includes('review') && request.review) {
    let users = request.message.reactions.filter(r => (settings.review.emojis.includes(r.name))).map(u => u.users);
    return `(:${settings.review.emojis[0]}: <@${users[0]}>)`
  }

  return '';
}


module.exports = create;