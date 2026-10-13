/** Hindi for People: the list, a person's sheet, contacts, greetings, messages, calls, visits, places. See common.ts for how Cue speaks Hindi. */
export const people: Record<string, string> = {
  // Wishes Cue drafts (OCCASION_MESSAGES, GREETING_OCCASIONS in @cue/shared), for the person to edit and send
  'Hi {first}, wishing you a very happy birthday! Have a wonderful year ahead.\n\nWarm regards,\n{me}':
    'नमस्ते {first}, जन्मदिन की बहुत-बहुत शुभकामनाएँ! आने वाला साल आपके लिए शानदार हो।\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, warm wishes on your anniversary! Wishing you many happy years ahead.\n\nWarm regards,\n{me}':
    'नमस्ते {first}, सालगिरह की हार्दिक शुभकामनाएँ! आने वाले साल खुशियों से भरे हों।\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you and your family a very happy Diwali! May the festival of lights bring you joy, good health and prosperity.\n\nWarm regards,\n{me}':
    'नमस्ते {first}, आपको और आपके परिवार को दीपावली की हार्दिक शुभकामनाएँ! रोशनी का यह त्योहार आपके जीवन में खुशियाँ, अच्छी सेहत और समृद्धि लाए।\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you a happy and successful New Year! Thank you for your support this year; I look forward to working together in the year ahead.\n\nWarm regards,\n{me}':
    'नमस्ते {first}, नए साल की हार्दिक शुभकामनाएँ! इस साल आपके साथ के लिए धन्यवाद; आने वाले साल में भी साथ काम करने का इंतज़ार रहेगा।\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you and your family a merry Christmas and a joyful holiday season!\n\nWarm regards,\n{me}':
    'नमस्ते {first}, आपको और आपके परिवार को क्रिसमस और छुट्टियों की ढेरों शुभकामनाएँ!\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you and your family a colourful and happy Holi!\n\nWarm regards,\n{me}':
    'नमस्ते {first}, आपको और आपके परिवार को रंगों भरी होली की हार्दिक शुभकामनाएँ!\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, Eid Mubarak! Wishing you and your family peace, happiness and prosperity.\n\nWarm regards,\n{me}':
    'नमस्ते {first}, ईद मुबारक! आपको और आपके परिवार को अमन, खुशी और समृद्धि की शुभकामनाएँ।\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you and your family a very happy Pongal and Makar Sankranti!\n\nWarm regards,\n{me}':
    'नमस्ते {first}, आपको और आपके परिवार को पोंगल और मकर संक्रांति की हार्दिक शुभकामनाएँ!\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, wishing you and your family a very happy Onam!\n\nWarm regards,\n{me}':
    'नमस्ते {first}, आपको और आपके परिवार को ओणम की हार्दिक शुभकामनाएँ!\n\nशुभकामनाओं सहित,\n{me}',
  'Hi {first}, \n\nWarm regards,\n{me}':
    'नमस्ते {first}, \n\nशुभकामनाओं सहित,\n{me}',
  // People
  'Nobody picked.': 'किसी को नहीं चुना।',
  '{n} added': '{n} जोड़े',
  '{n} filled in': '{n} में जानकारी भरी',
  '{n} already complete': '{n} पहले से पूरे',
  '{text}.': '{text}।',
  'Nothing changed.': 'कुछ नहीं बदला।',
  '{n} saved': '{n} सहेजे गए',
  '{n} with a number': '{n} नंबर के साथ',
  Accounts: 'अकाउंट',
  Companies: 'कंपनियाँ',
  'Search by name, role, workplace or phone': 'नाम, पद, काम की जगह या फ़ोन से खोजें',
  'Send greetings': 'शुभकामनाएँ भेजें',
  'Importing…': 'ला रहे हैं…',
  'From my phone': 'मेरे फ़ोन से',
  'Mentioned but not saved:': 'ज़िक्र हुआ, पर सहेजे नहीं:',
  'Coming up': 'आगे आने वाला',
  'next 30 days': 'अगले 30 दिन',
  birthday: 'जन्मदिन',
  anniversary: 'सालगिरह',
  'Send wishes': 'शुभकामनाएँ भेजें',
  'Time to reach out': 'संपर्क करने का समय',
  '1 person': '1 व्यक्ति',
  '{n} people': '{n} लोग',
  'last contact {when}': 'आखिरी संपर्क {when}',
  'no contact on record': 'कोई संपर्क दर्ज नहीं',
  Message: 'मैसेज',
  Talked: 'बात हो गई',
  'Nobody here yet': 'अभी यहाँ कोई नहीं',
  'Anyone you name while planning something is saved here on their own — say “call the plumber” and they appear. Add one by hand, or bring them over from your phone.':
    'कुछ प्लान करते समय आप जिसका भी नाम लेते हैं, वह अपने आप यहाँ सहेजा जाता है — “call the plumber” लिखें और वह यहाँ दिखेगा। किसी को खुद जोड़ें, या अपने फ़ोन से ले आएँ।',
  'Add someone': 'किसी को जोड़ें',
  'Nobody matches “{query}”': '“{query}” से कोई नहीं मिला',
  'Try part of a name, a job like “plumber”, or a phone number.':
    'नाम का कोई हिस्सा, “plumber” जैसा काम, या फ़ोन नंबर डालकर देखें।',
  'Reach out': 'संपर्क करें',
  'Waiting · {n}': 'इंतज़ार · {n}',
  'You owe · {n}': 'आपको देना है · {n}',
  'Next: {day}': 'अगली मीटिंग: {day}',
  'Last met {when}': 'आखिरी मुलाकात {when}',
  '1 meeting': '1 मीटिंग',
  '{n} meetings': '{n} मीटिंग',
  'No number': 'नंबर नहीं',
  'Wish {name}': '{name} को शुभकामनाएँ',
  'Birthday wishes': 'जन्मदिन की शुभकामनाएँ',
  'Anniversary wishes': 'सालगिरह की शुभकामनाएँ',
  'Message {name}': '{name} को मैसेज',
  Account: 'अकाउंट',
  Person: 'व्यक्ति',
  'Edit person': 'व्यक्ति की जानकारी बदलें',
  'Add person': 'व्यक्ति जोड़ें',

  // PersonSheet
  '{role} at {org}': '{org} में {role}',
  'Gathering everything with them…': 'उनसे जुड़ी हर चीज़ जुटा रहे हैं…',
  'Open {org} →': '{org} खोलें →',
  'Log a call': 'कॉल दर्ज करें',
  'Edit details': 'जानकारी बदलें',
  'Could not load what is open with {name} just now. Their details are here; try again in a moment for the rest.':
    '{name} के साथ जो बाकी है, वह अभी लोड नहीं हो सका। उनकी जानकारी यहाँ है; बाकी के लिए थोड़ी देर में फिर कोशिश करें।',
  'Next meeting': 'अगली मीटिंग',
  'Waiting on {name}': '{name} का इंतज़ार',
  'Nothing.': 'कुछ नहीं।',
  'check in now': 'अभी पूछें',
  'check in {day}': '{day} को पूछें',
  Nudge: 'याद दिलाएँ',
  'Got it': 'मिल गया',
  'You owe {name}': 'आपको {name} को देना है',
  'due {day}': '{day} तक देय',
  'Last met · {title} · {day}': 'आखिरी मुलाकात · {title} · {day}',
  'No follow-ups were noted from it.': 'उससे कोई फ़ॉलो-अप दर्ज नहीं हुआ।',
  'Keep in touch': 'संपर्क में रहें',
  Off: 'बंद',
  'Last contact {when}': 'आखिरी संपर्क {when}',
  'No contact on record yet': 'अभी तक कोई संपर्क दर्ज नहीं',
  'time to reach out': 'संपर्क करने का समय',
  'reminding you {day}': '{day} को याद दिलाएँगे',
  'next due {day}': 'अगली बार {day} को',
  'Talked today': 'आज बात हुई',
  Birthday: 'जन्मदिन',
  Anniversary: 'सालगिरह',
  'in {n} days': '{n} दिन में',
  'Money {name} owes you': '{name} पर आपका बकाया',
  'Recent calls': 'हाल की कॉल',
  Called: 'कॉल किया',
  'Also at {org}': '{org} में और लोग',
  '1 meeting in the last year': 'पिछले एक साल में 1 मीटिंग',
  '{n} meetings in the last year': 'पिछले एक साल में {n} मीटिंग',
  'the first on {day}': 'पहली {day} को',
  '1 visit logged': '1 मुलाकात दर्ज',
  '{n} visits logged': '{n} मुलाकातें दर्ज',
  'Nothing open with {name} yet. Add something below, or offer a time to meet.':
    '{name} के साथ अभी कुछ बाकी नहीं। नीचे कुछ जोड़ें, या मिलने का समय सुझाएँ।',
  'What do you owe {name}?': 'आपको {name} के लिए क्या करना है?',
  Due: 'कब तक',
  '+ Waiting on {name}': '+ {name} का इंतज़ार',
  '+ To do for {name}': '+ {name} के लिए काम',
  'Share when I’m free': 'मैं कब खाली हूँ, शेयर करें',

  // ContactEditor
  'Call {name}': '{name} को कॉल करें',
  Role: 'पद',
  'Manager, Recruiter, Landlord, Dentist…': 'मैनेजर, रिक्रूटर, मकान मालिक, डेंटिस्ट…',
  'Works at': 'कहाँ काम करते हैं',
  'Company or organisation, e.g. Infosys': 'कंपनी या संस्था, जैसे Infosys',
  'Saved place': 'सहेजी हुई जगह',
  '— none —': '— कोई नहीं —',
  'Cue tells you when it has been longer than this since you last met, talked or finished something with them.':
    'आखिरी बार मिलने, बात करने या उनके साथ कोई काम पूरा करने के बाद इससे ज़्यादा समय हो जाए, तो Cue आपको बताएगा।',
  'Prefers evening calls, decision maker, etc.': 'शाम को कॉल पसंद, फ़ैसला यही लेते हैं, वगैरह',
  'Open with this person': 'इस व्यक्ति के साथ बाकी',
  'Calls and visits · {n}': 'कॉल और मुलाकातें · {n}',
  'Save changes': 'बदलाव सहेजें',
  'Yes, delete': 'हाँ, हटाएँ',
  Keep: 'रहने दें',
  'Delete this person': 'इस व्यक्ति को हटाएँ',
  'Visits and follow-ups involving them are kept — deleting someone from your address book should not erase the record that you met them.':
    'उनसे जुड़ी मुलाकातें और फ़ॉलो-अप बने रहेंगे — किसी को संपर्क सूची से हटाने पर यह रिकॉर्ड नहीं मिटना चाहिए कि आप उनसे मिले थे।',

  // Greetings
  'Could not copy — select the message and copy it yourself.': 'कॉपी नहीं हो सका — मैसेज चुनकर खुद कॉपी करें।',
  '{occasion} · {sent} of {total} sent': '{occasion} · {total} में से {sent} भेजे',
  'Send to {name} by {via}': '{name} को {via} से भेजें',
  'Send to {name} ({org}) by {via}': '{name} ({org}) को {via} से भेजें',
  email: 'ईमेल',
  'Everyone has had it. Well done.': 'सबको भेज दिया। बहुत बढ़िया।',
  'Each opens with their own message, name and all. Send it there, come back, and tap for the next.':
    'हर एक के लिए उनका अपना मैसेज खुलता है, नाम समेत। वहाँ भेजें, वापस आएँ, और अगले के लिए टैप करें।',
  Sent: 'भेजा',
  'Done for now': 'अभी के लिए बस',
  'Continue {occasion}: {sent} of {total} sent': '{occasion} जारी रखें: {total} में से {sent} भेजे',
  'What for?': 'किस मौके पर?',
  'e.g. Ganesh Chaturthi': 'जैसे गणेश चतुर्थी',
  '{first} becomes each person’s name (Ravi, Dr. Rao), and {me} yours.':
    '{first} की जगह हर व्यक्ति का नाम आएगा (Ravi, Dr. Rao), और {me} की जगह आपका।',
  'Who to?': 'किसे?',
  'Everyone · {n}': 'सब · {n}',
  'By company': 'कंपनी के हिसाब से',
  'Choose people': 'लोग चुनें',
  'Search people': 'लोग खोजें',
  '1 person has no number or email, so they are left out.': '1 व्यक्ति का नंबर या ईमेल नहीं है, इसलिए वह छूट गया।',
  '{n} people have no number or email, so they are left out.':
    '{n} लोगों का नंबर या ईमेल नहीं है, इसलिए वे छूट गए।',
  'Getting ready…': 'तैयार कर रहे हैं…',
  'Start: 1 person': 'शुरू करें: 1 व्यक्ति',
  'Start: {n} people': 'शुरू करें: {n} लोग',

  // QuickMessage
  'Loading your messages…': 'आपके मैसेज लोड हो रहे हैं…',
  'No quick messages yet. Start from five that cover most days (thanks for meeting, missed your call, sharing the details, a gentle reminder, running late) and change them to sound like you.':
    'अभी कोई झटपट मैसेज नहीं। ज़्यादातर दिनों के काम आने वाले पाँच मैसेज से शुरू करें (मिलने के लिए धन्यवाद, आपकी कॉल छूट गई, जानकारी भेजना, हल्की-सी याद, देर हो रही है) और उन्हें अपने अंदाज़ में बदल लें।',
  'Add the starter messages': 'शुरुआती मैसेज जोड़ें',
  'Write my own': 'अपना लिखें',
  'Edit my messages': 'मेरे मैसेज बदलें',
  'WhatsApp {name}': '{name} को WhatsApp करें',
  Text: 'SMS',
  'Hi {first}, \n\n{me}': 'नमस्ते {first}, \n\n{me}',
  'e.g. Thanks for meeting': 'जैसे मिलने के लिए धन्यवाद',
  Insert: 'डालें',
  'Filled in when you send it: “{first}” becomes Ravi, or Dr. Rao for someone with a title.':
    'भेजते समय भर दिया जाता है: “{first}” की जगह Ravi आएगा, या किसी उपाधि वाले के लिए Dr. Rao।',
  'No quick messages yet.': 'अभी कोई झटपट मैसेज नहीं।',
  'Delete {title}': '{title} हटाएँ',
  '+ New message': '+ नया मैसेज',

  // CallLog
  'Saved. Now a message to {name}:': 'सहेज लिया। अब {name} को एक मैसेज:',
  'Who was it?': 'कौन था?',
  'A name from People, or a number': 'लोग में से कोई नाम, या नंबर',
  'Who was it? (optional)': 'कौन था? (वैकल्पिक)',
  'What was said? (optional)': 'क्या बात हुई? (वैकल्पिक)',
  'Mark “{title}” done': '“{title}” को हो गया मानें',
  'What next?': 'आगे क्या?',
  Nothing: 'कुछ नहीं',
  'Call again': 'फिर कॉल करें',
  'Something to do': 'कोई काम करना है',
  'Waiting on them': 'उनकी तरफ़ से बाकी',
  'e.g. Send the brochure': 'जैसे ब्रोशर भेजना',
  'What to do': 'क्या करना है',
  'What will {name} send or do?': '{name} क्या भेजेंगे या करेंगे?',
  'What will they send or do?': 'वे क्या भेजेंगे या करेंगे?',
  'What they will do': 'वे क्या करेंगे',
  'Check in': 'फिर पूछें',
  '“{title}” moves to {when}.': '“{title}” {when} पर चला जाएगा।',
  'Save and send a message': 'सहेजें और मैसेज भेजें',

  // CallTracker
  'Call with {name}: how did it go?': '{name} के साथ कॉल: कैसी रही?',
  'Log it': 'दर्ज करें',
  Dismiss: 'हटाएँ',
  'How did the call go?': 'कॉल कैसी रही?',

  // VisitEditor
  Purpose: 'मकसद',
  Business: 'काम का',
  Personal: 'निजी',
  'Not sure': 'पता नहीं',
  'Who was it with?': 'किसके साथ था?',
  Outcome: 'नतीजा',
  'Voice notes': 'वॉइस नोट',
  'When did this happen?': 'यह कब हुआ?',
  'Follow-ups from this visit': 'इस मुलाकात के फ़ॉलो-अप',
  done: 'हो गया',
  cancelled: 'रद्द',
  'Yes, delete it': 'हाँ, हटाएँ',
  'Keep it': 'रहने दें',
  'Delete this entry': 'यह एंट्री हटाएँ',
  'This removes the record only.': 'इससे सिर्फ़ यह रिकॉर्ड हटेगा।',
  'The 1 follow-up above will survive — a promise you made does not disappear because you deleted the note about the meeting.':
    'ऊपर वाला 1 फ़ॉलो-अप बना रहेगा — मीटिंग का नोट हटाने से आपका किया वादा ग़ायब नहीं होता।',
  'The {n} follow-ups above will survive — a promise you made does not disappear because you deleted the note about the meeting.':
    'ऊपर वाले {n} फ़ॉलो-अप बने रहेंगे — मीटिंग का नोट हटाने से आपका किया वादा ग़ायब नहीं होता।',

  // Places
  'No places yet.': 'अभी कोई जगह नहीं।',
  'The first time you log a visit somewhere new, it gets saved here and recognised automatically on every visit after that.':
    'किसी नई जगह पर पहली बार मुलाकात दर्ज करने पर वह यहाँ सहेजी जाती है, और उसके बाद हर बार अपने आप पहचान ली जाती है।',
  place: 'जगह',
  'Open with this place': 'इस जगह पर बाकी',
  'No visits recorded yet.': 'अभी कोई मुलाकात दर्ज नहीं।',

  // ProfilePhoto
  'This browser cannot resize images.': 'यह ब्राउज़र फ़ोटो छोटी नहीं कर सकता।',
  'Could not read that image.': 'यह फ़ोटो पढ़ी नहीं जा सकी।',
  'That image was not accepted.': 'यह फ़ोटो स्वीकार नहीं हुई।',
  'Working…': 'हो रहा है…',
  'Change photo': 'फ़ोटो बदलें',
  'Add a photo': 'फ़ोटो जोड़ें',
  'Square works best. It is resized on this device before it goes.':
    'चौकोर फ़ोटो सबसे अच्छी रहती है। भेजने से पहले इसी डिवाइस पर इसका साइज़ छोटा किया जाता है।',

  // deviceContacts
  'Reading your contacts needs a secure connection — it will work once this is on https.':
    'आपके संपर्क पढ़ने के लिए सुरक्षित कनेक्शन चाहिए — https पर आते ही यह काम करेगा।',
  'Your phone’s contact picker is only offered by Chrome on Android. On this device you can add people by hand.':
    'फ़ोन से संपर्क चुनने की सुविधा सिर्फ़ Android पर Chrome में मिलती है। इस डिवाइस पर आप लोगों को खुद जोड़ सकते हैं।',
  'This phone does not share any contact details.': 'यह फ़ोन संपर्क की कोई जानकारी शेयर नहीं करता।',

  // geo
  'This device has no location support.': 'इस डिवाइस में लोकेशन की सुविधा नहीं है।',
  'Location permission was denied. Enable it for this site and try again.':
    'लोकेशन की अनुमति नहीं मिली। इस साइट के लिए इसे चालू करें और फिर कोशिश करें।',
  'Could not get a fix. Move somewhere with a clearer sky view.':
    'लोकेशन पता नहीं चल सकी। किसी ऐसी जगह जाएँ जहाँ से आसमान साफ़ दिखे।',
  'Location timed out. Try again.': 'लोकेशन मिलने में बहुत देर लगी। फिर कोशिश करें।',

  // Labels from @cue/shared that these screens show with t()
  'Every 2 weeks': 'हर 2 हफ़्ते',
  'Every 3 months': 'हर 3 महीने',
  Spoke: 'बात हुई',
  'No answer': 'जवाब नहीं मिला',
  'Busy, call back': 'व्यस्त, फिर कॉल करें',
  'Left a message': 'मैसेज छोड़ा',
  'Went well': 'अच्छी रही',
  'Did not happen': 'नहीं हुई',
  Rescheduled: 'समय बदला',
  'Needs another visit': 'फिर जाना होगा',
  'All wrapped up': 'सब निपट गया',
  'Their name': 'उनका नाम',
  'Their full name': 'उनका पूरा नाम',
  'Where they work': 'वे कहाँ काम करते हैं',
  'Your name': 'आपका नाम',
  Diwali: 'दिवाली',
  'New Year': 'नया साल',
  Christmas: 'क्रिसमस',
  Holi: 'होली',
  Eid: 'ईद',
  'Pongal / Sankranti': 'पोंगल / संक्रांति',
  Onam: 'ओणम',
  'Something else': 'कुछ और',
}
