// Minimum 10 characters, block common passwords, no forced symbols.
const COMMON = new Set([
  "1234567890", "12345678910", "0123456789", "0987654321", "1111111111", "0000000000", "1234512345",
  "qwertyuiop", "qwerty1234", "qwerty12345", "asdfghjkl1", "1q2w3e4r5t", "1qaz2wsx3edc", "zaq12wsxcde",
  "password12", "password123", "password1234", "passw0rd123", "p@ssword123", "p@ssw0rd123",
  "iloveyou12", "iloveyou123", "welcome123", "welcome1234", "letmein123", "admin12345", "administrator",
  "abc1234567", "abcdefghij", "abcd123456", "trustno1234", "football12", "baseball12", "superman12",
  "sunshine12", "princess12", "dragon1234", "monkey1234", "starwars12", "computer12", "whatever12",
  "changeme123", "default123", "srilanka123", "colombo123", "tenxcreative", "10xcreative", "10xcreative123",
  "tenx123456", "company123", "client1234", "invoice123", "portal1234", "mypassword", "mypassword1",
  "secret1234", "secret12345", "qwerty123456", "123456789a", "a123456789", "aa12345678",
]);

export const PASSWORD_MIN = 10;

export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > 200) return "That password is too long.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose something harder to guess.";
  if (/^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  if (email) {
    const local = email.toLowerCase().split("@")[0];
    if (local.length >= 4 && lower.includes(local)) return "Do not use your email address in your password.";
  }
  return null;
}

/** 0..4 score for the strength meter (client side). */
export function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= PASSWORD_MIN) score++;
  if (password.length >= 14) score++;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (kinds >= 2) score++;
  if (kinds >= 3 || password.length >= 18) score++;
  if (COMMON.has(password.toLowerCase())) score = 0;
  return Math.min(score, 4);
}
