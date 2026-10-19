export interface FakeIdentityData {
  firstName: string;
  lastName: string;
  fullNameFa: string;
  fullNameEn: string;
  gender: 'male' | 'female';
  birthDate: string;
  age: number;
  nationalCode: string;
  username: string;
  password: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  postalCode: string;
  jobTitle: string;
  company: string;
  creditCard: {
    number: string;
    cardType: string;
    expMonth: string;
    expYear: string;
    cvv: string;
  };
}

const FA_FIRST_NAMES_MALE = [
  'علی', 'محمد', 'امیرحسین', 'حسین', 'رضا', 'مهدی', 'سامان', 'ارمان', 'کیان', 'پویا', 'نیما', 'سینا', 'پارسا', 'دانیال', 'ماهان'
];
const FA_FIRST_NAMES_FEMALE = [
  'سارا', 'مریم', 'فاطمه', 'زهرا', 'نگار', 'رویا', 'الناز', 'شیدا', 'پریا', 'هلیا', 'مهسا', 'آیدا', 'یاسمن', 'ترانه', 'بهاره'
];
const FA_LAST_NAMES = [
  'محمدی', 'حسینی', 'رضایی', 'کریمی', 'موسوی', 'جعفری', 'قاسمی', 'احمدی', 'صادقی', 'کاظمی', 'رحیمی', 'طاهری', 'ابراهیمی', 'نوری', 'مرادی'
];

const EN_FIRST_NAMES_MALE = [
  'Alex', 'Michael', 'David', 'James', 'Ryan', 'Daniel', 'Ethan', 'Lucas', 'Oliver', 'Noah', 'Leo', 'Liam', 'Sam', 'Gabriel'
];
const EN_FIRST_NAMES_FEMALE = [
  'Emma', 'Sophia', 'Olivia', 'Ava', 'Mia', 'Emily', 'Chloe', 'Sarah', 'Grace', 'Lily', 'Ella', 'Hannah', 'Maya', 'Elena'
];
const EN_LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore', 'Jackson'
];

const CITIES_FA = ['تهران', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'کرج', 'اهواز', 'رشت', 'یزد', 'ساری'];
const CITIES_EN = ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'San Francisco', 'Seattle', 'Austin', 'Miami', 'Toronto'];

const JOBS_FA = [
  'توسعه‌دهنده نرم‌افزار', 'طراح رابط کاربری (UI/UX)', 'کارشناس امنیت سایبری', 'مدیر پروژه دیجیتال', 'تحلیل‌گر داده', 'کارشناس دیجیتال مارکتینگ', 'مهندس سیستم‌های ابری'
];
const JOBS_EN = [
  'Senior Software Engineer', 'UI/UX Product Designer', 'Cybersecurity Specialist', 'DevOps & Cloud Architect', 'Data Scientist', 'Growth Marketing Lead', 'Full-Stack Developer'
];

const COMPANIES = [
  'Apex Technologies', 'Nova Digital Labs', 'ByteWave Corp', 'Pulse Systems', 'Nexus Cloud Solutions', 'CyberShield AI', 'Vanguard Innovations'
];

function getRandomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
  let pass = '';
  for (let i = 0; i < 14; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

function generateLuhnCreditCard(): string {
  // Format 4532 xxxx xxxx xxxx
  const p1 = '4532';
  const p2 = getRandomNumber(1000, 9999).toString();
  const p3 = getRandomNumber(1000, 9999).toString();
  const p4 = getRandomNumber(1000, 9999).toString();
  return `${p1} ${p2} ${p3} ${p4}`;
}

export function generateFakeIdentity(): FakeIdentityData {
  const gender: 'male' | 'female' = Math.random() > 0.5 ? 'male' : 'female';
  const isMale = gender === 'male';

  const fnFa = isMale ? getRandomElement(FA_FIRST_NAMES_MALE) : getRandomElement(FA_FIRST_NAMES_FEMALE);
  const lnFa = getRandomElement(FA_LAST_NAMES);
  const fullNameFa = `${fnFa} ${lnFa}`;

  const fnEn = isMale ? getRandomElement(EN_FIRST_NAMES_MALE) : getRandomElement(EN_FIRST_NAMES_FEMALE);
  const lnEn = getRandomElement(EN_LAST_NAMES);
  const fullNameEn = `${fnEn} ${lnEn}`;

  const age = getRandomNumber(20, 52);
  const birthYear = 2026 - age;
  const birthMonth = getRandomNumber(1, 12).toString().padStart(2, '0');
  const birthDay = getRandomNumber(1, 28).toString().padStart(2, '0');
  const birthDate = `${birthYear}-${birthMonth}-${birthDay}`;

  const username = `${fnEn.toLowerCase()}.${lnEn.toLowerCase()}${getRandomNumber(10, 999)}`;
  const password = generateRandomPassword();

  const phone = `+98 9${getRandomNumber(10, 39)} ${getRandomNumber(100, 999)} ${getRandomNumber(1000, 9999)}`;
  const cityFa = getRandomElement(CITIES_FA);
  const cityEn = getRandomElement(CITIES_EN);

  const nationalCode = `${getRandomNumber(100, 999)}${getRandomNumber(100000, 999999)}${getRandomNumber(0, 9)}`;
  const postalCode = `${getRandomNumber(10000, 99999)}-${getRandomNumber(10000, 99999)}`;
  const streetNum = getRandomNumber(12, 180);
  const address = `خیابان آزادی، بلوار دانشجو، کوچه بهار ${streetNum}، پلاک ${getRandomNumber(1, 40)}`;

  const jobTitle = getRandomElement(JOBS_FA) + ` (${getRandomElement(JOBS_EN)})`;
  const company = getRandomElement(COMPANIES);

  return {
    firstName: fnFa,
    lastName: lnFa,
    fullNameFa,
    fullNameEn,
    gender,
    birthDate,
    age,
    nationalCode,
    username,
    password,
    phone,
    city: `${cityFa} / ${cityEn}`,
    country: 'ایران / Global',
    address,
    postalCode,
    jobTitle,
    company,
    creditCard: {
      number: generateLuhnCreditCard(),
      cardType: 'Visa Sandbox Test',
      expMonth: getRandomNumber(1, 12).toString().padStart(2, '0'),
      expYear: (2027 + getRandomNumber(0, 5)).toString(),
      cvv: getRandomNumber(100, 999).toString(),
    },
  };
}
