/**
 * Hindi for the words every screen shares: buttons, the tabs, days and times.
 *
 * How Cue speaks Hindi, everywhere:
 * - Everyday Hindi, as people text it, not textbook Hindi: the English word
 *   where that is what people say (रिमाइंडर, ईमेल, कैलेंडर, ऐप, लिंक, PDF,
 *   OTP, UPI), written in Devanagari; Hindi where Hindi is what people say
 *   (आज, कल, खर्च, बिल, यात्रा, लोग).
 * - Asking politely: जोड़ें, देखें, हटाएँ — never जोड़ो.
 * - Names stay as they are: Cue, Google, Gmail, Outlook, WhatsApp, FASTag.
 * - Digits stay 0-9; ₹ and amounts as English writes them.
 * - The same thing is called the same everywhere:
 *     plan प्लान · reminder रिमाइंडर · note नोट · person व्यक्ति · people लोग
 *     contact संपर्क · trip यात्रा · bill बिल · expense खर्च · paid चुकाया
 *     due देय · overdue समय निकल गया · parcel पार्सल · delivery डिलीवरी
 *     repeating दोहराने वाले · history इतिहास · visit मुलाकात · call कॉल
 *     job नौकरी · hiring भर्ती · candidate उम्मीदवार · deal डील · client क्लाइंट
 *     tracker ट्रैकर · calendar कैलेंडर · email ईमेल · account खाता
 *     owed बकाया · lent उधार दिया · borrowed उधार लिया · receipt रसीद
 *     morning brief सुबह की झलक · week हफ़्ता · done हो गया
 */
export const common: Record<string, string> = {
  // The tabs and the menu
  Today: 'आज',
  People: 'लोग',
  History: 'इतिहास',
  Trips: 'यात्राएँ',
  Repeating: 'दोहराने वाले',
  Expenses: 'खर्च',
  Jobs: 'नौकरियाँ',
  Hiring: 'भर्ती',
  Deals: 'डील',
  Bills: 'बिल',
  Exams: 'परीक्षाएँ',
  More: 'और',
  Add: 'जोड़ें',
  Search: 'खोजें',
  Settings: 'सेटिंग्स',
  'Sign out': 'साइन आउट',
  'Sign in': 'साइन इन',
  'What I use Cue for…': 'Cue किस काम के लिए…',
  'What do you use Cue for?': 'आप Cue किस काम के लिए इस्तेमाल करते हैं?',
  'Review exam notices': 'परीक्षा सूचनाएँ जाँचें',
  'You’re trying Cue with a sample week. It’s deleted after a day.':
    'आप एक नमूना हफ़्ते के साथ Cue आज़मा रहे हैं। यह एक दिन बाद हट जाएगा।',
  'You’re trying Cue Exams with a sample aspirant’s account. It’s deleted after a day.':
    'आप एक नमूना अभ्यर्थी के खाते के साथ Cue Exams आज़मा रहे हैं। यह एक दिन बाद हट जाएगा।',
  'Create your free account': 'अपना मुफ़्त खाता बनाएँ',

  // The menu's groups (SECTION_GROUPS in @cue/shared)
  Everyday: 'रोज़ का',
  Money: 'पैसा',

  // Buttons
  Save: 'सहेजें',
  'Saving…': 'सहेज रहे हैं…',
  Cancel: 'रद्द करें',
  Delete: 'हटाएँ',
  Remove: 'हटाएँ',
  Edit: 'बदलें',
  Change: 'बदलें',
  Done: 'हो गया',
  Close: 'बंद करें',
  Back: 'वापस',
  Next: 'आगे',
  Skip: 'छोड़ें',
  Undo: 'वापस लें',
  Retry: 'फिर कोशिश करें',
  'Open it': 'खोलें',
  'Too many wrong passwords. Wait 15 minutes, or reset your password.': 'बहुत बार गलत पासवर्ड डाला गया। 15 मिनट रुकें, या पासवर्ड रीसेट करें।',
  'This account has been turned off. Write to support to have it turned back on.': 'यह अकाउंट बंद कर दिया गया है। इसे फिर से चालू करवाने के लिए सपोर्ट को लिखें।',

  // What went wrong, said plainly (lib/errors.ts)
  'Something in that did not look right. Check it and try again.': 'इसमें कुछ ठीक नहीं लगा। जाँचकर फिर कोशिश करें।',
  'That did not go through. Try again.': 'यह नहीं हो पाया। फिर कोशिश करें।',
  'The upload did not go through. Try again.': 'अपलोड नहीं हो पाया। फिर कोशिश करें।',
  'Something went wrong on our side. Try again in a moment.': 'हमारी तरफ़ कुछ गड़बड़ हुई। थोड़ी देर में फिर कोशिश करें।',
  'Too many tries. Wait a minute and try again.': 'बहुत बार कोशिश हुई। एक मिनट रुककर फिर कोशिश करें।',
  'Could not load your messages just now.': 'अभी आपके संदेश लोड नहीं हो सके।',
  'Could not search just now.': 'अभी खोज नहीं हो सकी।',
  'Could not load your settings just now.': 'अभी आपकी सेटिंग्स लोड नहीं हो सकीं।',
  'Could not open this trip just now.': 'अभी यह यात्रा खुल नहीं सकी।',
  'Could not load your accounts just now.': 'अभी आपके अकाउंट लोड नहीं हो सके।',
  'Could not load your history just now.': 'अभी आपका इतिहास लोड नहीं हो सका।',
  'Could not load your people just now.': 'अभी आपके लोग लोड नहीं हो सके।',
  'Could not load your trips just now.': 'अभी आपकी यात्राएँ लोड नहीं हो सकीं।',
  'See them': 'देखें',
  'Their page': 'उनका पेज',
  'Try again': 'फिर कोशिश करें',
  Yes: 'हाँ',
  No: 'नहीं',
  'Not now': 'अभी नहीं',
  Open: 'खोलें',
  Show: 'दिखाएँ',
  Hide: 'छिपाएँ',
  'Show less': 'कम दिखाएँ',
  Copy: 'कॉपी करें',
  Copied: 'कॉपी हो गया',
  Call: 'कॉल करें',
  Disconnect: 'हटाएँ',
  'Loading…': 'लोड हो रहा है…',
  Optional: 'वैकल्पिक',
  Notes: 'नोट',
  Name: 'नाम',
  Phone: 'फ़ोन',
  Email: 'ईमेल',
  Date: 'तारीख',
  When: 'कब',
  Where: 'कहाँ',
  Who: 'कौन',
  What: 'क्या',
  Place: 'जगह',
  None: 'कोई नहीं',
  All: 'सब',
  Other: 'अन्य',

  // Days and times
  Tomorrow: 'कल',
  Yesterday: 'बीता कल',
  'Today {time}': 'आज {time}',
  'Tomorrow {time}': 'कल {time}',
  'This week': 'इस हफ़्ते',
  'Next week': 'अगले हफ़्ते',
  Morning: 'सुबह',
  Afternoon: 'दोपहर',
  Evening: 'शाम',
  Night: 'रात',
  'just now': 'अभी',
  '{n} min': '{n} मिनट',
  '{n}h': '{n} घंटे',
  '{n}d': '{n} दिन',
  'In 1 hour': '1 घंटे में',
  'In 3 hours': '3 घंटे में',
  'Tomorrow 10am': 'कल सुबह 10 बजे',
  'In 3 days': '3 दिन में',
  today: 'आज',
  tomorrow: 'कल',
  yesterday: 'बीता कल',
  '1 day': '1 दिन',
  '{n} days': '{n} दिन',
  '1 week': '1 हफ़्ते',
  '{n} weeks': '{n} हफ़्ते',
  '1 month': '1 महीने',
  '{n} months': '{n} महीने',
  '1 year': '1 साल',
  '{n} years': '{n} साल',
  'in {span}': '{span} में',
  '{span} ago': '{span} पहले',
  '{day} · all day': '{day} · पूरा दिन',
  '{from} → {to} · {n} days': '{from} → {to} · {n} दिन',
  'Every day': 'हर दिन',
  'Every week': 'हर हफ़्ते',
  'Every month': 'हर महीने',
  'Every year': 'हर साल',
}
