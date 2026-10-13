/** Hindi for quick add: what it understood, what it assumed, what it asks. Same rules as the web app's apps/web/src/lib/hi/common.ts. */
export const capture: Record<string, string> = {
  '{name} owes you {amount}': '{name} पर {amount} बाकी',
  // A plan read back
  '{title} — {when}, whenever suits': '{title} — {when}, जब सुविधा हो',
  '{title} — {repeat}, from {date}': '{title} — {repeat}, {date} से',
  '{title} — {repeat} at {times}, from {date}': '{title} — {repeat}, {times} पर, {date} से',
  'Trip to {place}, {dates}': '{place} की यात्रा, {dates}',
  '"{title}" saved for {place}': '"{title}" {place} के लिए सहेजा',
  '{n} things saved for {place}: {list}': '{place} के लिए {n} चीज़ें सहेजीं: {list}',
  '{n} things on your wishlist: {list}': 'आपकी विशलिस्ट में {n} चीज़ें: {list}',
  '{n} things to tick off: {items}': 'पूरी करने के लिए {n} चीज़ें: {items}',
  '{n} reminders a day: {times}.': 'दिन में {n} रिमाइंडर: {times}।',
  'Every year, on the day.': 'हर साल, उसी दिन।',

  // What it filled in
  'No time given, so 9am.': 'कोई समय नहीं दिया, इसलिए सुबह 9 बजे।',
  'No time given, so {when}, whenever suits.': 'कोई समय नहीं दिया, इसलिए {when}, जब सुविधा हो।',
  'No time given, so it is filed for {when} with no set slot.': 'कोई समय नहीं दिया, इसलिए इसे बिना तय समय के {when} के लिए रखा है।',
  'No time given, so {time}; change it if you know.': 'कोई समय नहीं दिया, इसलिए {time}; पता हो तो बदल दें।',
  'No time given, so breakfast time, {time}.': 'कोई समय नहीं दिया, इसलिए नाश्ते का समय, {time}।',
  'No time given, so brunch time, {time}.': 'कोई समय नहीं दिया, इसलिए ब्रंच का समय, {time}।',
  'No time given, so lunch time, {time}.': 'कोई समय नहीं दिया, इसलिए दोपहर के खाने का समय, {time}।',
  'No time given, so dinner time, {time}.': 'कोई समय नहीं दिया, इसलिए रात के खाने का समय, {time}।',
  'No date given, so this is the next one.': 'कोई तारीख नहीं दी, इसलिए अगली बार वाला समय रखा है।',
  'this morning': 'आज सुबह',
  'this afternoon': 'आज दोपहर',
  'this evening': 'आज शाम',
  'tomorrow morning': 'कल सुबह',
  'Read as {time}. Say {other} if you meant that.': '{time} समझा। अगर {other} कहना था, तो वह लिखें।',
  'Due by {date}.': '{date} तक देय।',
  'Due {day} at 5 pm, so it is ready in time.': '{day} शाम 5 बजे तक देय, ताकि समय पर तैयार रहे।',
  'No date — it waits until you plan a trip to {place}.': 'कोई तारीख नहीं — यह तब तक रुका रहेगा, जब तक आप {place} की यात्रा प्लान नहीं करते।',
  'No date: they wait until you plan a trip to {place}, then go on it together.':
    'कोई तारीख नहीं: जब आप {place} की यात्रा प्लान करेंगे, तब ये सब साथ में उसमें जुड़ जाएँगे।',
  'No date and no place: add them to any plan from its details, whenever it suits.':
    'न तारीख, न जगह: जब सुविधा हो, किसी भी प्लान के विवरण में से इन्हें जोड़ें।',
  'Read carefully by Cue’s AI, as the usual rules were not sure.': 'आम नियम पक्के नहीं थे, इसलिए Cue के AI ने इसे ध्यान से पढ़ा।',

  // Before and after something already planned
  'After "{anchor}", which ends that day — {n} min later.': '"{anchor}" के बाद, जो उस दिन ख़त्म होता है — {n} मिनट बाद।',
  'Before "{anchor}", which starts that day — {n} min earlier.': '"{anchor}" से पहले, जो उस दिन शुरू होता है — {n} मिनट पहले।',
  'I could not find "{anchor}" that day to go before, so: when?': 'उस दिन "{anchor}" नहीं मिला, जिससे पहले इसे रखूँ — तो, कब?',
  'I could not find "{anchor}" that day to go after, so: when?': 'उस दिन "{anchor}" नहीं मिला, जिसके बाद इसे रखूँ — तो, कब?',
  'I could not find "{anchor}" in the next week to go before, so: when?': 'अगले एक हफ़्ते में "{anchor}" नहीं मिला, जिससे पहले इसे रखूँ — तो, कब?',
  'I could not find "{anchor}" in the next week to go after, so: when?': 'अगले एक हफ़्ते में "{anchor}" नहीं मिला, जिसके बाद इसे रखूँ — तो, कब?',
  'I could not find anything that day to go before, so: when?': 'उस दिन ऐसा कुछ नहीं मिला, जिससे पहले इसे रखूँ — तो, कब?',
  'I could not find anything that day to go after, so: when?': 'उस दिन ऐसा कुछ नहीं मिला, जिसके बाद इसे रखूँ — तो, कब?',
  'I could not find anything in the next week to go before, so: when?': 'अगले एक हफ़्ते में ऐसा कुछ नहीं मिला, जिससे पहले इसे रखूँ — तो, कब?',
  'I could not find anything in the next week to go after, so: when?': 'अगले एक हफ़्ते में ऐसा कुछ नहीं मिला, जिसके बाद इसे रखूँ — तो, कब?',

  // Who, where, what kind
  'Read as: {value}': 'इस तरह समझा: {value}',
  'Who: {value}': 'कौन: {value}',
  'Where: {value}': 'कहाँ: {value}',
  'About: {value}': 'किस बारे में: {value}',
  appointment: 'अपॉइंटमेंट',
  meeting: 'मीटिंग',
  call: 'कॉल',
  visit: 'मुलाकात',
  demo: 'डेमो',
  interview: 'इंटरव्यू',
  'You said {person} is in {place} before.': 'आपने पहले बताया था कि {person} {place} में हैं।',
  'Matched {name} ({phone}) from your contacts.': 'आपके संपर्कों में {name} ({phone}) मिले।',
  'Matched {name} from your contacts.': 'आपके संपर्कों में {name} मिले।',

  // What history said
  'Last time this was at {place}.': 'पिछली बार यह {place} में था।',
  'Last time this was at {time}.': 'पिछली बार यह {time} पर था।',
  'You have done this {n} times — usually {min} min, at {place}.': 'आप यह {n} बार कर चुके हैं — आम तौर पर {min} मिनट, {place} में।',
  'You have done this {n} times — usually {min} min.': 'आप यह {n} बार कर चुके हैं — आम तौर पर {min} मिनट।',
  'You have done this {n} times — at {place}.': 'आप यह {n} बार कर चुके हैं — {place} में।',
  'You usually do this around {time}.': 'आप यह आम तौर पर {time} के आसपास करते हैं।',

  // Asking
  'When is it?': 'यह कब है?',
  'What time is “{title}” on {day}?': '{day} को “{title}” किस समय है?',
  'When is “{title}”?': '“{title}” कब है?',
  'You’re free at:': 'आप इन समयों पर खाली हैं:',
  'Who is “{word}”?': '“{word}” कौन है?',
  'Today {time}': 'आज {time}',
  'Tomorrow {time}': 'कल {time}',

  // When it could not tell
  'That does not look like something to plan. Say what, and when.': 'यह प्लान करने की बात नहीं लगती। क्या करना है और कब, यह लिखें।',
  'That is all repeat and no plan — say what it is.': 'इसमें सिर्फ़ दोहराना है, काम नहीं — बताएँ कि क्या करना है।',
  'That series has nothing left in it.': 'इस सिलसिले में आगे कुछ नहीं बचा।',
  'I could not find a date or time in that.': 'इसमें मुझे कोई तारीख या समय नहीं मिला।',
  'I got the time but not what it is for.': 'समय तो मिल गया, पर यह किस काम के लिए है, यह नहीं।',
  'I could not read "{time}" as a time.': '"{time}" को मैं समय की तरह नहीं पढ़ पाया।',

  // Tracked things
  'Part of your {title} application.': 'आपके {title} आवेदन से जुड़ा।',
  'Part of your {title} application; it moves to Interviewing.': 'आपके {title} आवेदन से जुड़ा; यह अब इंटरव्यू के चरण में जाएगा।',
  'Part of your {title} candidate.': 'उम्मीदवार {title} से जुड़ा।',
  'Part of your {title} candidate; it moves to Interviewing.': 'उम्मीदवार {title} से जुड़ा; यह अब इंटरव्यू के चरण में जाएगा।',
  'Part of your {title} deal.': 'आपकी {title} डील से जुड़ा।',
  'Part of your {title} deal; it moves to Interviewing.': 'आपकी {title} डील से जुड़ा; यह अब इंटरव्यू के चरण में जाएगा।',

  // Money
  '{amount} from {name}': '{name} से {amount}',
  'On your {place} trip.': 'आपकी {place} यात्रा में।',
  'Spent on {date}.': '{date} को खर्च किया।',

  // Bills and renewals
  'A reminder 3 days before.': 'देय तारीख से 3 दिन पहले एक रिमाइंडर।',
  'A reminder 3 days before, each time.': 'हर बार, देय तारीख से 3 दिन पहले एक रिमाइंडर।',
  'A reminder a week before it is due.': 'देय तारीख से एक हफ़्ता पहले एक रिमाइंडर।',
  'A reminder a month before it expires.': 'ख़त्म होने से एक महीना पहले एक रिमाइंडर।',
  'A reminder a month before it runs out.': 'ख़त्म होने से एक महीना पहले एक रिमाइंडर।',
  'A reminder 10 days before it runs out.': 'ख़त्म होने से 10 दिन पहले एक रिमाइंडर।',
  'No date to pay by in the message, so a month from when it was issued.': 'मैसेज में भुगतान की कोई तारीख नहीं थी, इसलिए जारी होने से एक महीने बाद तक।',
  'Balance {amount}. Running out can mean paying double at the toll.': 'बैलेंस {amount}। ख़त्म हो जाए तो टोल पर दोगुना देना पड़ सकता है।',
  'Low balance. Running out can mean paying double at the toll.': 'बैलेंस कम है। ख़त्म हो जाए तो टोल पर दोगुना देना पड़ सकता है।',

  // Parcels
  Parcel: 'पार्सल',
  'arriving today': 'आज आएगा',
  'arriving tomorrow': 'कल आएगा',
  'expected {date}': '{date} तक आने की उम्मीद',
  '{amount} cash on delivery': '{amount} कैश ऑन डिलीवरी',
  'A reminder on the morning it arrives.': 'जिस दिन आएगा, उस सुबह एक रिमाइंडर।',

  // Bookings
  'A reminder at {time} to leave for the airport, {lead}, with the reference to hand.':
    '{time} पर एयरपोर्ट के लिए निकलने का रिमाइंडर, {lead}; रेफ़रेंस साथ रखें।',
  'A reminder at {time} to leave for the airport, {lead}, with the details to hand.':
    '{time} पर एयरपोर्ट के लिए निकलने का रिमाइंडर, {lead}; बुकिंग की जानकारी साथ रखें।',
  'A reminder at {time} to leave for the station, {lead}, with the reference to hand.':
    '{time} पर स्टेशन के लिए निकलने का रिमाइंडर, {lead}; रेफ़रेंस साथ रखें।',
  'A reminder at {time} to leave for the station, {lead}, with the details to hand.':
    '{time} पर स्टेशन के लिए निकलने का रिमाइंडर, {lead}; बुकिंग की जानकारी साथ रखें।',
  'A reminder at {time} to leave for the bus, {lead}, with the reference to hand.':
    '{time} पर बस के लिए निकलने का रिमाइंडर, {lead}; रेफ़रेंस साथ रखें।',
  'A reminder at {time} to leave for the bus, {lead}, with the details to hand.':
    '{time} पर बस के लिए निकलने का रिमाइंडर, {lead}; बुकिंग की जानकारी साथ रखें।',
  'A reminder {lead}, with the reference to hand.': '{lead} एक रिमाइंडर; रेफ़रेंस साथ रखें।',
  'A reminder {lead}, with the details to hand.': '{lead} एक रिमाइंडर; बुकिंग की जानकारी साथ रखें।',
  'A web check-in reminder 48 hours before.': '48 घंटे पहले वेब चेक-इन का रिमाइंडर।',
  'That booking was for {when}, which has passed.': 'यह बुकिंग {when} की थी — वह समय निकल चुका है।',

  // Exams
  'Exams: {exam}': 'परीक्षा: {exam}',
  'reg no {number}': 'रजिस्ट्रेशन नंबर {number}',
  'mock {score}/{outOf} ({percent}%)': 'मॉक टेस्ट {score}/{outOf} ({percent}%)',
  'Added to the {exam} you are tracking.': 'आप जिस {exam} पर नज़र रख रहे हैं, उसमें जोड़ा।',
  'Kept with your mock scores, on the exam’s page.': 'परीक्षा के पेज पर, आपके मॉक स्कोर के साथ रखा।',
  'Reminders 3 days before the last date, the evening before, and on the day.': 'अंतिम तिथि से 3 दिन पहले, एक शाम पहले और उसी दिन रिमाइंडर।',
  'Reminders a week before the exam, the evening before, and that morning.': 'परीक्षा से एक हफ़्ता पहले, एक शाम पहले और उसी सुबह रिमाइंडर।',

  // Better plans, offered
  'Passport and visa appointments can take weeks.': 'पासपोर्ट और वीज़ा की अपॉइंटमेंट में हफ़्तों लग सकते हैं।',
  'Paperwork like this can take a couple of weeks.': 'ऐसे काग़ज़ी काम में दो-एक हफ़्ते लग सकते हैं।',
  'Tax filing goes easier with the papers gathered a week ahead.': 'काग़ज़ एक हफ़्ता पहले जुटा लें, तो टैक्स भरना आसान रहता है।',
  'Work like this goes better started a week ahead.': 'ऐसा काम एक हफ़्ता पहले शुरू करें, तो बेहतर होता है।',
  'A week’s head start, so it is not a rush at the end.': 'एक हफ़्ता पहले शुरू करें, ताकि आख़िर में भागदौड़ न हो।',
  'Remind me to start {day}': '{day} को शुरू करने की याद दिलाएँ',
  'You’re in {place} {span}, so you won’t be here for this. Move it, or make it a call.':
    'आप {span} {place} में हैं, इसलिए इसके लिए यहाँ नहीं होंगे। इसे आगे बढ़ाएँ, या कॉल पर कर लें।',
  'Move to {day}': '{day} पर ले जाएँ',
  'An hour to get ready makes these go better.': 'तैयारी के लिए एक घंटा मिले, तो ये बेहतर होते हैं।',
  'Block {day}, {time}': '{day}, {time} का समय रखें',
  'You need to leave by {time}. Book a cab to the airport the evening before?': '{time} तक निकलना है। एक शाम पहले एयरपोर्ट के लिए कैब बुक कर लें?',
  'You need to leave by {time}. Book a cab to the station the evening before?': '{time} तक निकलना है। एक शाम पहले स्टेशन के लिए कैब बुक कर लें?',
  'Remind me {day}, 8 pm': '{day}, रात 8 बजे याद दिलाएँ',
  'A reminder the evening before leaves time for a gift or a call.': 'एक शाम पहले का रिमाइंडर, ताकि तोहफ़े या कॉल का समय रहे।',
  'Remind me the evening before': 'एक शाम पहले याद दिलाएँ',
}
