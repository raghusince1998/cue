import { Link } from 'react-router-dom'
import { SITE } from '../lib/site.ts'

/**
 * What the privacy policy and the terms say, in English and in Hindi. Written
 * to what the code does, so it can be checked against it.
 *
 * The two languages say the same thing, section for section and point for
 * point: change one, change the other. scripts/legal.test.ts counts the
 * sections, points and links of each pair. Where they differ, the English is
 * the one that counts, and the Hindi says so.
 */

const host = SITE.url.replace('https://', '')
const mail = <a href={`mailto:${SITE.supportEmail}`}>{SITE.supportEmail}</a>
const googlePolicy = (
  <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
    Google API Services User Data Policy
  </a>
)

export function PrivacyEn() {
  return (
    <>
      <p>
        Cue ({SITE.url}) is a personal planner: plans and reminders, people, trips, bills, expenses and
        parcels, and — if you connect an account — what your calendar and email already say about them.
        This policy explains what Cue collects, what it does with it, and the choices you have. It covers Cue
        Exams too — Cue’s app for exam aspirants — which is the same service and the same account.
      </p>

      <h2>What Cue keeps</h2>
      <ul>
        <li><strong>Your account:</strong> your name, email address and a one-way hash of your password (never the password itself), and a profile photo if you add one.</li>
        <li><strong>What you add:</strong> plans, reminders, notes, people and their details, places, trips, bills, expenses (and receipt photos), money owed, job applications and other trackers, exams you are tracking, and voice notes if you record them.</li>
        <li><strong>Exams:</strong> the exams you add, where each stands, their dates, and the registration and roll numbers and exam centre you enter or confirm. An admit card you choose to read, or one a board emails you, is read in memory and not kept; only its details are saved (the exam day, roll number and centre), and you can change them. Cue never asks for an exam portal&rsquo;s or Rajasthan SSO&rsquo;s password, an OTP or your date of birth, and never signs in to any portal for you. Cue also reads exam boards&rsquo; public notice pages — nothing about you is sent to them — and a person checks each new notice before anyone tracking that exam is told of it. If you add your roll number, Cue looks for it in the result lists boards publish, on its own server; your number is not sent anywhere. A result list you choose to look through yourself is read in memory and not kept. Study plans and mock test scores you add are kept with the exam. If you say how far you have studied (10th, 12th, graduate, postgraduate) and any training (ITI, engineering, teacher training), it is kept to show which open forms fit you and to tell you when a form opens for an exam like yours — never your date of birth; you can turn those alerts off. The tool that resizes a photo or signature for a form works on your device: the image is never uploaded.</li>
        <li><strong>Location, only when you ask:</strong> when you log a visit or look for things nearby, your device’s position at that moment. Cue does not track your location in the background.</li>
        <li><strong>To send reminders:</strong> your device’s push subscription and your time zone.</li>
      </ul>

      <h2>Connected Google and Microsoft accounts</h2>
      <p>
        You can connect a Google account (Calendar and Gmail) or a Microsoft account (Outlook and Calendar).
        Cue asks only for <strong>read-only</strong> access: it can never send, delete, change or move an email
        or a calendar event.
      </p>
      <ul>
        <li><strong>Calendar</strong> (<code>calendar.readonly</code>, <code>Calendars.Read</code>): the events of the calendars you choose are copied into Cue so your day shows in one place, and refreshed regularly.</li>
        <li><strong>Email</strong> (<code>gmail.readonly</code>, <code>Mail.Read</code>): Cue looks only at messages from the kinds of senders that send bookings, deliveries and bills — railways and airlines, booking sites, shops and couriers, banks and card issuers, insurers, utilities, the transport department and FASTag issuers, and exam boards and testing agencies. From each, it reads what it needs to make a plan, a parcel, a bill, a renewal reminder or an exam&rsquo;s dates: dates, amounts, reference numbers, vehicle numbers, exam registration and roll numbers. A password or one-time code in an email is never read out of it or kept.</li>
        <li><strong>No email is stored.</strong> Messages are read in memory, and so is a ticket attached to one as a PDF (an e-ticket, a train reservation slip). Cue keeps only the message’s identifier, so it is not read twice, and the short description of what it found (for example “Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi, Sat 17 Oct”), which you can see in Settings. When Cue’s reading improves, the last month of these messages may be read again to correct what was found.</li>
        <li>Email is read by Cue’s own code. It is <strong>not</strong> sent to any AI service, never shown to advertisers, never sold, and not used to train any model.</li>
        <li>People do not read your email. The only exceptions are if you ask us to look at a specific problem and agree to it, for security reasons such as investigating abuse, or where the law requires it.</li>
        <li>Access tokens are stored encrypted. Disconnecting an account in Settings deletes them and, for Google, withdraws Cue’s access at Google too. You can also remove Cue at myaccount.google.com/permissions or myapps.microsoft.com at any time.</li>
      </ul>
      <p className="legal-callout">
        Cue’s use and transfer to any other app of information received from Google APIs will adhere to
        the {googlePolicy}, including the Limited Use requirements.
      </p>

      <h2>How Cue uses your information</h2>
      <p>Only to run Cue for you: showing your plans, sending your reminders, and turning connected calendars and emails into plans, parcels, bills and reminders. Cue does not sell personal information, does not use it for advertising, and does not build profiles of you for anyone else.</p>

      <h2>Who else handles it</h2>
      <ul>
        <li><strong>Hosting:</strong> Cue runs on Amazon Web Services, where its database and servers are.</li>
        <li><strong>Notifications:</strong> reminders are delivered through your browser’s push service (Google, Apple or Mozilla), which carries the reminder text to your device.</li>
        <li><strong>Place lookups:</strong> when you look up a place by name, that name is sent to OpenStreetMap or Google Places to find it.</li>
        <li><strong>Password reset emails</strong> are sent through an email delivery provider.</li>
        <li><strong>Reading unclear lines (Anthropic):</strong> Cue reads what you type with its own rules first. When they cannot read a line with confidence — a vague one like “doctor”, or Hindi they do not know — Cue may send that one line, with today’s date, to Anthropic’s Claude API to understand it, and shows you the result before anything is saved. Nothing else goes with it: not your name, email address, contacts or other plans. Anthropic’s commercial terms do not allow it to train its models on what is sent. Email is never sent.</li>
        <li><strong>AI with your own key:</strong> if you add your own AI key in Settings, text you ask Cue to read with it is sent to the AI provider you chose. This is off unless you set it up, and never applies to email.</li>
      </ul>
      <p>Cue may disclose information if required by law, or to protect its users and service from fraud or abuse.</p>

      <h2 id="delete">How long it is kept, and deleting it</h2>
      <ul>
        <li>What you add stays until you delete it. Deleting a plan, a person or a bill removes it.</li>
        <li><strong>Delete your account</strong> in Settings: your account and everything in it are deleted, and connected accounts are disconnected first. This works the same in the app from the Play Store and on the website: sign in at {host}, open Settings, then Delete my account.</li>
        <li>Can&rsquo;t sign in? Email {mail} from the address on your account, and it will be deleted, with everything in it, within 7 days.</li>
        <li>Demo accounts made from the homepage hold only sample data and are deleted automatically after a day.</li>
        <li>Backups of the database, if kept, are overwritten within weeks.</li>
      </ul>

      <h2>Security</h2>
      <p>Connections use HTTPS. Passwords are hashed; connected-account tokens are encrypted; each account’s data is kept apart from every other account’s.</p>

      <h2>Children</h2>
      <p>Cue is not meant for children under 13, and does not knowingly collect their information.</p>

      <h2>Changes</h2>
      <p>If this policy changes, the date at the top changes too, and anything that affects how your data is used will be shown in the app before it applies.</p>

      <h2>Contact</h2>
      <p>Questions, requests to see or delete your data, or concerns: {mail}.</p>
    </>
  )
}

export function PrivacyHi() {
  return (
    <>
      <p>
        Cue ({SITE.url}) एक निजी प्लानर है: प्लान और रिमाइंडर, लोग, यात्राएँ, बिल, खर्च और पार्सल — और अगर
        आप कोई खाता जोड़ते हैं, तो आपके कैलेंडर और ईमेल में इनके बारे में जो पहले से लिखा है। यह नीति बताती है
        कि Cue क्या जानकारी लेता है, उसका क्या करता है, और आपके पास क्या विकल्प हैं। यह Cue Exams पर भी लागू
        होती है — परीक्षा की तैयारी करने वालों के लिए Cue का ऐप — जो वही सेवा और वही खाता है।
      </p>

      <h2>Cue क्या रखता है</h2>
      <ul>
        <li><strong>आपका खाता:</strong> आपका नाम, ईमेल पता और आपके पासवर्ड का एक-तरफ़ा हैश (पासवर्ड खुद कभी नहीं), और प्रोफ़ाइल फ़ोटो, अगर आप लगाएँ।</li>
        <li><strong>जो आप जोड़ते हैं:</strong> प्लान, रिमाइंडर, नोट, लोग और उनकी जानकारी, जगहें, यात्राएँ, बिल, खर्च (और रसीदों की फ़ोटो), बकाया पैसे, नौकरी के आवेदन और दूसरे ट्रैकर, जिन परीक्षाओं पर आप नज़र रखते हैं, और वॉइस नोट, अगर आप रिकॉर्ड करें।</li>
        <li><strong>परीक्षाएँ:</strong> आपकी जोड़ी परीक्षाएँ, हर एक कहाँ तक पहुँची, उनकी तारीखें, और रजिस्ट्रेशन नंबर, रोल नंबर और परीक्षा केंद्र, जो आप भरें या पक्का करें। जो प्रवेश पत्र आप पढ़वाते हैं, या जो कोई बोर्ड आपको ईमेल करता है, उसे मेमोरी में पढ़ा जाता है और रखा नहीं जाता; सिर्फ़ उसकी जानकारी सहेजी जाती है (परीक्षा का दिन, रोल नंबर और केंद्र), और आप उसे बदल सकते हैं। Cue कभी किसी परीक्षा पोर्टल या राजस्थान SSO का पासवर्ड, OTP या आपकी जन्मतिथि नहीं माँगता, और आपकी ओर से किसी पोर्टल में साइन इन नहीं करता। Cue परीक्षा बोर्डों के सार्वजनिक सूचना पेज भी पढ़ता है — आपके बारे में कुछ भी उन्हें नहीं भेजा जाता — और हर नई सूचना, उस परीक्षा पर नज़र रखने वाले किसी को भी बताए जाने से पहले, एक व्यक्ति जाँचता है। अगर आप अपना रोल नंबर जोड़ते हैं, तो Cue बोर्डों की प्रकाशित परिणाम सूचियों में उसे अपने ही सर्वर पर ढूँढता है; आपका नंबर कहीं नहीं भेजा जाता। जो परिणाम सूची आप खुद देखने के लिए चुनते हैं, उसे मेमोरी में पढ़ा जाता है और रखा नहीं जाता। आपकी जोड़ी पढ़ाई की योजनाएँ और मॉक टेस्ट के अंक परीक्षा के साथ रखे जाते हैं। अगर आप बताते हैं कि आपने कहाँ तक पढ़ाई की है (10वीं, 12वीं, स्नातक, स्नातकोत्तर) और कोई प्रशिक्षण (ITI, इंजीनियरिंग, शिक्षक प्रशिक्षण), तो यह यह दिखाने के लिए रखा जाता है कि कौन-से खुले फॉर्म आपके लायक हैं, और आपकी जैसी परीक्षा का फॉर्म खुलने पर आपको बताने के लिए — आपकी जन्मतिथि कभी नहीं; ये सूचनाएँ आप बंद कर सकते हैं। फ़ॉर्म के लिए फ़ोटो या हस्ताक्षर का आकार बदलने वाला टूल आपके डिवाइस पर ही चलता है: तस्वीर कभी अपलोड नहीं होती।</li>
        <li><strong>लोकेशन, सिर्फ़ जब आप कहें:</strong> जब आप कोई मुलाकात दर्ज करते हैं या आस-पास की चीज़ें देखते हैं, उस पल आपके डिवाइस की जगह। Cue बैकग्राउंड में आपकी लोकेशन ट्रैक नहीं करता।</li>
        <li><strong>रिमाइंडर भेजने के लिए:</strong> आपके डिवाइस की पुश सब्सक्रिप्शन और आपका टाइम ज़ोन।</li>
      </ul>

      <h2>जोड़े गए Google और Microsoft खाते</h2>
      <p>
        आप एक Google खाता (Calendar और Gmail) या एक Microsoft खाता (Outlook और Calendar) जोड़ सकते हैं। Cue
        सिर्फ़ <strong>पढ़ने की</strong> अनुमति माँगता है: यह कभी कोई ईमेल या कैलेंडर इवेंट भेज, हटा, बदल या
        इधर-उधर नहीं कर सकता।
      </p>
      <ul>
        <li><strong>कैलेंडर</strong> (<code>calendar.readonly</code>, <code>Calendars.Read</code>): आपके चुने हुए कैलेंडरों के इवेंट Cue में कॉपी किए जाते हैं, ताकि आपका दिन एक जगह दिखे, और नियमित रूप से ताज़ा किए जाते हैं।</li>
        <li><strong>ईमेल</strong> (<code>gmail.readonly</code>, <code>Mail.Read</code>): Cue सिर्फ़ उन तरह के भेजने वालों के मैसेज देखता है जो बुकिंग, डिलीवरी और बिल भेजते हैं — रेलवे और एयरलाइंस, बुकिंग साइटें, दुकानें और कूरियर, बैंक और कार्ड कंपनियाँ, बीमा कंपनियाँ, बिजली-पानी जैसी सेवाएँ, परिवहन विभाग और FASTag जारी करने वाले, और परीक्षा बोर्ड व परीक्षा एजेंसियाँ। हर एक से यह सिर्फ़ वही पढ़ता है जो प्लान, पार्सल, बिल, रिन्यूअल रिमाइंडर या परीक्षा की तारीखें बनाने के लिए चाहिए: तारीखें, राशि, रेफ़रेंस नंबर, गाड़ी के नंबर, परीक्षा के रजिस्ट्रेशन और रोल नंबर। ईमेल में लिखा पासवर्ड या वन-टाइम कोड कभी उसमें से पढ़ा या रखा नहीं जाता।</li>
        <li><strong>कोई ईमेल रखा नहीं जाता।</strong> मैसेज मेमोरी में पढ़े जाते हैं, और PDF के रूप में जुड़ा टिकट भी (ई-टिकट, ट्रेन रिज़र्वेशन स्लिप)। Cue सिर्फ़ मैसेज की पहचान (आईडी) रखता है, ताकि उसे दोबारा न पढ़ा जाए, और जो मिला उसका छोटा-सा विवरण (जैसे “Train 12951 Mumbai Rajdhani · Mumbai Central → New Delhi, Sat 17 Oct”), जिसे आप सेटिंग्स में देख सकते हैं। जब Cue का पढ़ना बेहतर होता है, तो जो मिला उसे सुधारने के लिए पिछले एक महीने के ऐसे मैसेज दोबारा पढ़े जा सकते हैं।</li>
        <li>ईमेल Cue का अपना कोड पढ़ता है। इसे किसी AI सेवा को <strong>नहीं</strong> भेजा जाता, विज्ञापन देने वालों को कभी नहीं दिखाया जाता, कभी बेचा नहीं जाता, और किसी मॉडल को ट्रेन करने में इस्तेमाल नहीं होता।</li>
        <li>लोग आपका ईमेल नहीं पढ़ते। अपवाद सिर्फ़ ये हैं: अगर आप हमसे किसी खास समस्या को देखने को कहें और इसके लिए सहमति दें, सुरक्षा कारणों से, जैसे दुरुपयोग की जाँच, या जहाँ कानून इसकी माँग करे।</li>
        <li>ऐक्सेस टोकन एन्क्रिप्ट करके रखे जाते हैं। सेटिंग्स में खाता हटाने पर वे मिट जाते हैं और, Google के मामले में, Google पर भी Cue की पहुँच वापस ले ली जाती है। आप कभी भी myaccount.google.com/permissions या myapps.microsoft.com पर Cue को हटा सकते हैं।</li>
      </ul>
      <p className="legal-callout">
        Google API से मिली जानकारी का Cue द्वारा इस्तेमाल, और किसी दूसरे ऐप को उसका हस्तांतरण, {googlePolicy}{' '}
        का पालन करेगा, जिसमें उसकी Limited Use की शर्तें भी शामिल हैं।
      </p>

      <h2>Cue आपकी जानकारी का इस्तेमाल कैसे करता है</h2>
      <p>सिर्फ़ आपके लिए Cue चलाने के लिए: आपके प्लान दिखाना, आपके रिमाइंडर भेजना, और जोड़े गए कैलेंडर और ईमेल को प्लान, पार्सल, बिल और रिमाइंडर में बदलना। Cue निजी जानकारी नहीं बेचता, उसे विज्ञापन के लिए इस्तेमाल नहीं करता, और किसी और के लिए आपकी प्रोफ़ाइल नहीं बनाता।</p>

      <h2>और कौन इसे संभालता है</h2>
      <ul>
        <li><strong>होस्टिंग:</strong> Cue, Amazon Web Services पर चलता है, जहाँ इसका डेटाबेस और सर्वर हैं।</li>
        <li><strong>नोटिफ़िकेशन:</strong> रिमाइंडर आपके ब्राउज़र की पुश सेवा (Google, Apple या Mozilla) से पहुँचते हैं, जो रिमाइंडर का टेक्स्ट आपके डिवाइस तक ले जाती है।</li>
        <li><strong>जगह खोजना:</strong> जब आप किसी जगह को नाम से खोजते हैं, तो उसे ढूँढने के लिए वह नाम OpenStreetMap या Google Places को भेजा जाता है।</li>
        <li><strong>पासवर्ड रीसेट के ईमेल</strong> एक ईमेल डिलीवरी सेवा के ज़रिए भेजे जाते हैं।</li>
        <li><strong>साफ़ न पढ़ी जा सकने वाली लाइनें (Anthropic):</strong> Cue आपकी लिखी बात पहले अपने नियमों से पढ़ता है। जब वे किसी लाइन को भरोसे से नहीं पढ़ पाते — “doctor” जैसी अधूरी लाइन, या ऐसी हिन्दी जो वे नहीं जानते — तो Cue उसे समझने के लिए सिर्फ़ वह एक लाइन, आज की तारीख के साथ, Anthropic के Claude API को भेज सकता है, और कुछ भी सहेजने से पहले नतीजा आपको दिखाता है। उसके साथ और कुछ नहीं जाता: न आपका नाम, न ईमेल पता, न संपर्क, न दूसरे प्लान। Anthropic की व्यावसायिक शर्तें उसे भेजी गई चीज़ों पर अपने मॉडल ट्रेन करने की अनुमति नहीं देतीं। ईमेल कभी नहीं भेजा जाता।</li>
        <li><strong>आपकी अपनी AI key के साथ:</strong> अगर आप सेटिंग्स में अपनी AI key जोड़ते हैं, तो जो टेक्स्ट आप उससे Cue से पढ़वाते हैं, वह आपके चुने AI प्रदाता को भेजा जाता है। यह तब तक बंद रहता है जब तक आप इसे सेट न करें, और ईमेल पर कभी लागू नहीं होता।</li>
      </ul>
      <p>कानून की माँग पर, या अपने उपयोगकर्ताओं और सेवा को धोखाधड़ी या दुरुपयोग से बचाने के लिए, Cue जानकारी दे सकता है।</p>

      <h2 id="delete">जानकारी कितने समय रहती है, और उसे मिटाना</h2>
      <ul>
        <li>जो आप जोड़ते हैं, वह तब तक रहता है जब तक आप उसे न हटाएँ। कोई प्लान, व्यक्ति या बिल हटाने से वह मिट जाता है।</li>
        <li><strong>अपना खाता मिटाएँ</strong>, सेटिंग्स में: आपका खाता और उसमें सब कुछ मिटा दिया जाता है, और जोड़े गए खाते पहले हटा दिए जाते हैं। Play Store वाले ऐप और वेबसाइट, दोनों पर यह एक जैसा काम करता है: {host} पर साइन इन करें, सेटिंग्स खोलें, फिर “मेरा खाता हटाएँ”।</li>
        <li>साइन इन नहीं कर पा रहे? अपने खाते वाले ईमेल पते से {mail} पर लिखें, और आपका खाता, उसमें सब कुछ के साथ, 7 दिनों के अंदर मिटा दिया जाएगा।</li>
        <li>होमपेज से बने डेमो खातों में सिर्फ़ नमूना डेटा होता है, और वे एक दिन बाद अपने आप मिट जाते हैं।</li>
        <li>डेटाबेस के बैकअप, अगर रखे जाते हैं, कुछ हफ़्तों में मिटकर नए हो जाते हैं।</li>
      </ul>

      <h2>सुरक्षा</h2>
      <p>कनेक्शन HTTPS से होते हैं। पासवर्ड हैश किए जाते हैं; जोड़े गए खातों के टोकन एन्क्रिप्ट होते हैं; हर खाते का डेटा बाकी सभी खातों से अलग रखा जाता है।</p>

      <h2>बच्चे</h2>
      <p>Cue 13 साल से कम उम्र के बच्चों के लिए नहीं है, और जानबूझकर उनकी जानकारी नहीं लेता।</p>

      <h2>बदलाव</h2>
      <p>अगर यह नीति बदलती है, तो ऊपर की तारीख भी बदलती है, और आपके डेटा के इस्तेमाल पर असर डालने वाली कोई भी बात लागू होने से पहले ऐप में दिखाई जाएगी।</p>

      <h2>संपर्क</h2>
      <p>सवाल, अपना डेटा देखने या मिटाने के अनुरोध, या कोई चिंता: {mail}।</p>
    </>
  )
}

export function TermsEn() {
  return (
    <>
      <p>These terms apply when you use Cue at {SITE.url}. By creating an account or using Cue, you agree to them.</p>

      <h2>Your account</h2>
      <ul>
        <li>Keep your password safe; you are responsible for what is done with your account.</li>
        <li>Give a real email address, so password resets reach you.</li>
        <li>You may delete your account at any time in Settings.</li>
      </ul>

      <h2>Your content</h2>
      <p>What you put into Cue stays yours. You let Cue store and process it only to run the service for you, as described in the <Link to="/privacy">privacy policy</Link>.</p>

      <h2>Using Cue properly</h2>
      <ul>
        <li>Do not use Cue to break the law, to harm others, or to store anything you do not have the right to.</li>
        <li>Do not try to get into other people’s accounts, overload the service, or get around its limits.</li>
        <li>Connect only accounts that are yours, or that you are allowed to connect.</li>
      </ul>

      <h2>Reminders are a help, not a guarantee</h2>
      <p>
        Cue tries hard to remind you on time and to read bookings, bills and due dates correctly, but
        notifications can be delayed or blocked by your device, and messages can be read wrongly. Check
        anything important — a train time, an amount due, a policy’s expiry — against the original. Cue is
        not responsible for missed payments, journeys, renewals or fines.
      </p>

      <h2>The service</h2>
      <p>Cue is offered as it is. Features may change, and the service may occasionally be unavailable. If Cue ever closes, you will be told in advance and given a chance to take your data with you.</p>

      <h2>Ending</h2>
      <p>You can stop using Cue and delete your account whenever you like. Accounts used to abuse the service may be suspended.</p>

      <h2>Contact</h2>
      <p>{mail}</p>
    </>
  )
}

export function TermsHi() {
  return (
    <>
      <p>ये शर्तें तब लागू होती हैं जब आप {SITE.url} पर Cue इस्तेमाल करते हैं। खाता बनाकर या Cue इस्तेमाल करके, आप इनसे सहमत होते हैं।</p>

      <h2>आपका खाता</h2>
      <ul>
        <li>अपना पासवर्ड सुरक्षित रखें; आपके खाते से जो भी किया जाए, उसकी ज़िम्मेदारी आपकी है।</li>
        <li>असली ईमेल पता दें, ताकि पासवर्ड रीसेट का ईमेल आप तक पहुँचे।</li>
        <li>आप सेटिंग्स में कभी भी अपना खाता मिटा सकते हैं।</li>
      </ul>

      <h2>आपकी सामग्री</h2>
      <p>Cue में आप जो डालते हैं, वह आपका ही रहता है। आप Cue को उसे सिर्फ़ आपके लिए सेवा चलाने के लिए रखने और प्रोसेस करने देते हैं, जैसा <Link to="/privacy">गोपनीयता नीति</Link> में बताया गया है।</p>

      <h2>Cue का सही इस्तेमाल</h2>
      <ul>
        <li>Cue का इस्तेमाल कानून तोड़ने, दूसरों को नुकसान पहुँचाने, या ऐसी कोई चीज़ रखने के लिए न करें जिसका आपको अधिकार नहीं है।</li>
        <li>दूसरों के खातों में घुसने, सेवा पर ज़रूरत से ज़्यादा बोझ डालने, या उसकी सीमाओं से बचने की कोशिश न करें।</li>
        <li>सिर्फ़ वही खाते जोड़ें जो आपके हैं, या जिन्हें जोड़ने की आपको अनुमति है।</li>
      </ul>

      <h2>रिमाइंडर एक मदद हैं, गारंटी नहीं</h2>
      <p>
        Cue आपको समय पर याद दिलाने और बुकिंग, बिल और आखिरी तारीखें सही पढ़ने की पूरी कोशिश करता है, लेकिन
        नोटिफ़िकेशन आपके डिवाइस की वजह से देर से आ सकते हैं या रुक सकते हैं, और मैसेज गलत पढ़े जा सकते हैं। कोई
        भी ज़रूरी बात — ट्रेन का समय, देय राशि, पॉलिसी खत्म होने की तारीख — मूल से मिला लें। छूटे भुगतानों,
        यात्राओं, रिन्यूअल या जुर्मानों के लिए Cue ज़िम्मेदार नहीं है।
      </p>

      <h2>सेवा</h2>
      <p>Cue जैसा है, वैसा ही दिया जाता है। सुविधाएँ बदल सकती हैं, और सेवा कभी-कभी उपलब्ध न हो। अगर Cue कभी बंद होता है, तो आपको पहले से बताया जाएगा और अपना डेटा साथ ले जाने का मौका दिया जाएगा।</p>

      <h2>इस्तेमाल बंद करना</h2>
      <p>आप जब चाहें Cue इस्तेमाल करना बंद कर सकते हैं और अपना खाता मिटा सकते हैं। सेवा का दुरुपयोग करने वाले खाते निलंबित किए जा सकते हैं।</p>

      <h2>संपर्क</h2>
      <p>{mail}</p>
    </>
  )
}
