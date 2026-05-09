// Exchange rate service — currency conversion with static rates for major currencies
// Production should use a live feed (OpenExchangeRates, ECB, etc.)

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

// USD-based rates (approximate mid-market, May 2026)
const USD_RATES: Record<string, number> = {
  USD: 1.0,      EUR: 0.92,     GBP: 0.79,     JPY: 145.0,
  CAD: 1.37,     AUD: 1.53,     CHF: 0.89,     CNY: 7.24,
  HKD: 7.82,     NZD: 1.66,     SEK: 10.40,    KRW: 1320.0,
  SGD: 1.34,     NOK: 10.70,    MXN: 17.50,    INR: 83.0,
  BRL: 5.20,     ZAR: 18.30,    TRY: 32.0,     RUB: 92.0,
  AED: 3.67,     SAR: 3.75,     PLN: 4.10,     THB: 36.0,
  DKK: 6.85,     MYR: 4.70,     PHP: 57.0,     IDR: 16000.0,
  VND: 25000.0,  EGP: 48.0,     NGN: 1500.0,   ARS: 870.0,
  CLP: 920.0,    COP: 4100.0,   PEN: 3.75,     CZK: 22.80,
  HUF: 360.0,    ILS: 3.70,     RON: 4.57,
};

const CURRENCY_INFO: Record<string, CurrencyInfo> = {
  USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  EUR: { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  GBP: { code: 'GBP', name: 'British Pound', symbol: '£', decimals: 2 },
  JPY: { code: 'JPY', name: 'Japanese Yen', symbol: '¥', decimals: 0 },
  CAD: { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimals: 2 },
  AUD: { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimals: 2 },
  CHF: { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', decimals: 2 },
  CNY: { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
  INR: { code: 'INR', name: 'Indian Rupee', symbol: '₹', decimals: 2 },
  BRL: { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', decimals: 2 },
  MXN: { code: 'MXN', name: 'Mexican Peso', symbol: 'Mex$', decimals: 2 },
  KRW: { code: 'KRW', name: 'South Korean Won', symbol: '₩', decimals: 0 },
};

export const exchangeRates = {
  listCurrencies(): CurrencyInfo[] {
    return Object.values(CURRENCY_INFO);
  },

  getCurrency(code: string): CurrencyInfo | undefined {
    return CURRENCY_INFO[code.toUpperCase()];
  },

  getRates(): Record<string, number> {
    return { ...USD_RATES };
  },

  convert(amountCents: number, from: string, to: string): { resultCents: number; rate: number; from: string; to: string } {
    const fromRate = USD_RATES[from.toUpperCase()];
    const toRate = USD_RATES[to.toUpperCase()];
    if (!fromRate) throw new Error(`Unknown currency: ${from}`);
    if (!toRate) throw new Error(`Unknown currency: ${to}`);

    // Convert via USD: from → USD → to
    const usdAmount = amountCents / fromRate;
    const resultCents = Math.round(usdAmount * toRate);

    return {
      resultCents,
      rate: Number((toRate / fromRate).toFixed(6)),
      from: from.toUpperCase(),
      to: to.toUpperCase(),
    };
  },

  formatAmount(cents: number, currencyCode: string): string {
    const info = this.getCurrency(currencyCode) ?? CURRENCY_INFO.USD;
    const amount = cents / Math.pow(10, info.decimals);
    return `${info.symbol}${amount.toFixed(info.decimals)}`;
  },
};
