// OAuth/SSO service — Google & GitHub login flows with account linking
import { v4 as uuid } from 'uuid';

interface OAuthTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface GoogleProfileData {
  id: string;
  sub?: string;
  email: string;
  name?: string;
  picture?: string;
}

interface GitHubProfileData {
  id: number;
  email: string | null;
  login?: string;
  name?: string;
  avatar_url?: string;
}

interface GitHubEmailData {
  email: string;
  primary: boolean;
  verified: boolean;
}

export interface OAuthConfig {
  provider: 'google' | 'github';
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthState {
  id: string;
  provider: string;
  redirectAfter?: string;
  tenantId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface OAuthProfile {
  provider: string;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

const states: OAuthState[] = [];
const linkedAccounts: Array<{
  userId: string;
  tenantId: string;
  provider: string;
  providerId: string;
  email: string;
  linkedAt: string;
}> = [];

const configs: OAuthConfig[] = [];

function getConfig(provider: string): OAuthConfig | undefined {
  return configs.find(c => c.provider === provider) ?? {
    provider: provider as 'google' | 'github',
    clientId: process.env[`${provider.toUpperCase()}_CLIENT_ID`] ?? '',
    clientSecret: process.env[`${provider.toUpperCase()}_CLIENT_SECRET`] ?? '',
    redirectUri: process.env[`${provider.toUpperCase()}_REDIRECT_URI`] ?? '',
  };
}

export const oauthService = {
  setConfig(config: OAuthConfig): void {
    const idx = configs.findIndex(c => c.provider === config.provider);
    if (idx >= 0) configs[idx] = config;
    else configs.push(config);
  },

  createAuthUrl(provider: 'google' | 'github', redirectAfter?: string, tenantId?: string): { url: string; stateId: string } {
    const config = getConfig(provider);
    const stateId = uuid();
    const now = new Date();

    states.push({
      id: stateId, provider, redirectAfter, tenantId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
    });

    let url: string;
    if (provider === 'google') {
      const params = new URLSearchParams({
        client_id: config!.clientId,
        redirect_uri: config!.redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: stateId,
      });
      url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    } else {
      const params = new URLSearchParams({
        client_id: config!.clientId,
        redirect_uri: config!.redirectUri,
        scope: 'user:email',
        state: stateId,
      });
      url = `https://github.com/login/oauth/authorize?${params}`;
    }

    return { url, stateId };
  },

  validateState(stateId: string): OAuthState | null {
    const s = states.find(ss => ss.id === stateId);
    if (!s || new Date(s.expiresAt) < new Date()) return null;
    return s;
  },

  async exchangeCode(provider: string, code: string): Promise<{ profile: OAuthProfile; accessToken: string } | null> {
    const config = getConfig(provider);
    if (!config) return null;

    try {
      let tokenUrl: string;
      let profileUrl: string;

      if (provider === 'google') {
        tokenUrl = 'https://oauth2.googleapis.com/token';
        profileUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
      } else {
        tokenUrl = 'https://github.com/login/oauth/access_token';
        profileUrl = 'https://api.github.com/user';
      }

      // Token exchange
      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      const tokenData: OAuthTokenResponse = await tokenRes.json() as OAuthTokenResponse;
      const accessToken = tokenData.access_token;
      if (!accessToken) return null;

      // Profile fetch
      const profileRes = await fetch(profileUrl, {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'entex' },
      });
      const profileData = await profileRes.json() as Record<string, unknown>;

      let email: string | null = (profileData.email as string) ?? null;
      if (provider === 'github' && !email) {
        // Fetch emails separately for GitHub
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'entex' },
        });
        const emails = await emailRes.json() as GitHubEmailData[];
        const primary = emails?.find(e => e.primary);
        email = primary?.email ?? emails?.[0]?.email ?? '';
      }

      return {
        profile: {
          provider,
          providerId: String((profileData.id ?? profileData.sub) ?? ''),
          email,
          name: (profileData.name ?? profileData.login ?? '') as string,
          avatarUrl: (profileData.picture ?? profileData.avatar_url) as string | undefined,
        },
        accessToken,
      };
    } catch {
      return null;
    }
  },

  linkAccount(userId: string, tenantId: string, profile: OAuthProfile): void {
    const existing = linkedAccounts.find(
      a => a.userId === userId && a.provider === profile.provider,
    );
    if (existing) return;
    linkedAccounts.push({
      userId, tenantId, provider: profile.provider,
      providerId: profile.providerId, email: profile.email,
      linkedAt: new Date().toISOString(),
    });
  },

  getLinkedAccounts(userId: string): Array<{ provider: string; email: string; linkedAt: string }> {
    return linkedAccounts
      .filter(a => a.userId === userId)
      .map(({ provider, email, linkedAt }) => ({ provider, email, linkedAt }));
  },

  findUserByProvider(provider: string, providerId: string): { userId: string; tenantId: string } | undefined {
    const a = linkedAccounts.find(la => la.provider === provider && la.providerId === providerId);
    return a ? { userId: a.userId, tenantId: a.tenantId } : undefined;
  },

  unlinkAccount(userId: string, provider: string): boolean {
    const idx = linkedAccounts.findIndex(a => a.userId === userId && a.provider === provider);
    if (idx === -1) return false;
    linkedAccounts.splice(idx, 1);
    return true;
  },
};
