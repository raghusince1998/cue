/**
 * Exam boards' emails, as Cue receives them: subject, sender, then the body.
 * Modelled on how each board writes; every name and number is made up. Read
 * by examMail.test.ts and by the mail reader's own test, which reads them
 * from a fake inbox.
 */
const mail = (from: string, subject: string, body: string) => `${subject}\n${from}\n${body}`

export const EXAM_MAIL = {
  sscRegistered: mail(
    'Staff Selection Commission <no-reply@ssc.gov.in>',
    'Application submitted successfully - Combined Graduate Level Examination, 2026',
    `Dear Candidate,
Your online application for Combined Graduate Level Examination, 2026 has been submitted successfully.
Registration Number: 61234567890
Please take a printout of the application form for future reference.
Staff Selection Commission`,
  ),
  rrbRegistered: mail(
    'RRB Apply <noreply@rrbapply.gov.in>',
    'Registration Successful - CEN 05/2024',
    `Dear ASHA MEENA,
You have successfully registered for CEN No. 05/2024 (NTPC Graduate Level Posts).
Your Registration Number is 241051234567890 and Password is Asha@1234.
Please complete your application and pay the fee before 20/10/2026 23:59 hrs.
Railway Recruitment Boards`,
  ),
  ntaCity: mail(
    'NTA NEET <neet-ug@nta.ac.in>',
    'NEET (UG) 2027: Advance Intimation of Examination City',
    `Dear Candidate,
The Advance City Intimation Slip for NEET (UG) – 2027 is now available.
Application No.: 270410123456
Date of Examination: 02/05/2027
Examination City: KOTA (RAJASTHAN)
This is not the Admit Card. The Admit Card will be issued separately.
National Testing Agency`,
  ),
  ntaAdmitCard: mail(
    'JEE Main <jeemain@nta.ac.in>',
    'Admit Card for JEE (Main) 2027 Session 1 released',
    `Dear Candidate,
The Admit Card for JEE (Main) 2027 Session 1 has been released and can be downloaded from https://jeemain.nta.nic.in using your Application Number and Date of Birth.
Application No.: 270310654321
The examination will be held on 22nd January, 2027.`,
  ),
  upscAdmitCard: mail(
    'UPSC <noreply@upsconline.gov.in>',
    'e-Admit Card: Civil Services (Preliminary) Examination, 2027',
    `The e-Admit Card for the Civil Services (Preliminary) Examination, 2027 to be held on 24.05.2027 is available on the Commission's website.
Registration ID: 12345678901
Candidates are advised to download it and check the particulars carefully.`,
  ),
  ibpsCallLetter: mail(
    'IBPS <noreply@ibps.in>',
    'CRP PO/MT-XVI: Call letter for Online Preliminary Examination',
    `Dear Candidate,
Your call letter for the Online Preliminary Examination of CRP PO/MT-XVI is available for download.
Registration No: 1500123456
Date of Examination: 07/11/2026`,
  ),
  sscAnswerKey: mail(
    'Staff Selection Commission <no-reply@ssc.gov.in>',
    'Tentative Answer Keys - Combined Graduate Level Examination 2026 (Tier-I)',
    `The Tentative Answer Keys of Combined Graduate Level Examination 2026 (Tier-I) have been uploaded.
Representations, if any, may be submitted from 10/11/2026 to 13/11/2026 (06:00 PM).`,
  ),
  rpscResult: mail(
    'Rajasthan Public Service Commission <noreply@rpsc.rajasthan.gov.in>',
    'RAS/RTS Combined Competitive (Preliminary) Exam 2026 - Result',
    `The result of the RAS/RTS Combined Competitive (Preliminary) Examination 2026 has been declared.
Candidates who have qualified are eligible for the Main Examination to be held on 21 June 2027.`,
  ),
  rbiShortlist: mail(
    'RBI Recruitment <recruitment@rbi.org.in>',
    'RBI Grade B 2026 - Phase II result',
    `Dear Candidate,
Congratulations! You have been shortlisted for the Interview of RBI Grade B 2026.
Roll No: 2610045678`,
  ),
  otp: mail(
    'Staff Selection Commission <no-reply@ssc.gov.in>',
    'OTP for registration',
    'Your OTP for registration for SSC CGL 2026 on the SSC portal is 482913. Do not share it with anyone.',
  ),
  coaching: mail(
    'Testbook <news@testbook.com>',
    'SSC CGL Admit Card 2026 Out: Download Now',
    'SSC CGL admit card 2026 has been released for Tier 1. Click here to download. Join our test series today!',
  ),
}

/** The same, split back into what a mailbox hands over. */
export function asMessage(text: string): { subject: string; from: string; body: string } {
  const [subject, from, ...rest] = text.split('\n')
  return { subject: subject!, from: from!, body: rest.join('\n') }
}
