export const LIMITS = {
  codeMaxChars: 100_000,
  stagesMin: 4,
  stagesMax: 6,
  tokensPerUser: 10,
  historyMax: 50,
  audioWindowMaxMs: 60_000,
  oauthGrantsPerUser: 20,
} as const;
