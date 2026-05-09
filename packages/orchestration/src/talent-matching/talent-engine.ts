// TalentEngine — ML-free predictive talent marketplace.
// Deterministic weighted scoring models powered by historical booking data.
// Moat 8: Predictive Talent Marketplace — 3-year moat through automated matching
// that improves with every booking.

// ─── Public interfaces ─────────────────────────────────────────────────────

export interface TalentMatch {
  artistId: string;
  venueId: string;
  compatibilityScore: number; // 0-100
  factors: {
    genreFit: number;          // 0-25
    capacityFit: number;       // 0-25
    priceFit: number;          // 0-20
    geographicFit: number;     // 0-15
    historicalSuccess: number; // 0-15
  };
  recommendation: 'strong_match' | 'good_match' | 'possible_match' | 'not_recommended';
  expectedDraw: number;
  recommendedPriceCents: number;
}

export interface DemandForecast {
  targetId: string;
  targetType: 'artist' | 'venue';
  forecast: Array<{
    month: string;        // YYYY-MM
    predictedBookings: number;
    confidenceLow: number;
    confidenceHigh: number;
  }>;
  seasonality: Array<{
    month: number;        // 1-12
    coefficient: number;  // multiplier vs baseline
  }>;
  trend: 'growing' | 'stable' | 'declining';
  trendStrength: number;  // 0-1
}

export interface CareerTrajectory {
  artistId: string;
  currentStage: 'emerging' | 'rising' | 'established' | 'headliner' | 'declining';
  bookingFrequency: Array<{ month: string; count: number }>;
  avgRateGrowth: number;     // % per month
  genreBreadth: number;      // number of distinct genres booked
  nextStageProbability: number; // 0-1 likelihood of advancing
  projectedMonthlyBookings6m: number;
}

// ─── Input data shapes (mirrors DB rows, no framework dependency) ───────────

export interface ArtistProfile {
  id: string;
  tenantId: string;
  businessId: string;
  stageName: string;
  genres: string[];
  hourlyRateCents: number | null;
  travelRadiusMiles: number | null;
  status: string;
  createdAt: string;
}

export interface VenueProfile {
  id: string;
  tenantId: string;
  businessId: string;
  name: string;
  venueType: string | null;
  city: string | null;
  state: string | null;
  capacity: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BookingRecord {
  id: string;
  tenantId: string;
  artistId: string | null;
  venueId: string | null;
  status: string;
  eventType: string;
  eventDate: string; // ISO date
  start_time: string;
  end_time: string;
  quotedAmountCents: number | null;
  totalAmountCents: number | null;
  depositAmountCents: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Store interface (injected for testability, same pattern as PassportVerifierStores) ───

export interface TalentStore {
  getArtists(artistIds?: string[]): ArtistProfile[];
  getVenues(venueIds?: string[]): VenueProfile[];
  getBookings(artistId?: string | null, venueId?: string | null): BookingRecord[];
}

// ─── Genre → venue-type compatibility matrix ────────────────────────────────

// Maps common artist genres to venue types they perform well at.
// Values 0-1 indicate how naturally the genre fits the venue.
const GENRE_VENUE_COMPATIBILITY: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map([
  ['rock', new Map([['concert_hall', 1.0], ['festival', 0.95], ['bar', 0.7], ['club', 0.6], ['theater', 0.4]])],
  ['pop', new Map([['concert_hall', 0.9], ['festival', 0.95], ['club', 0.7], ['theater', 0.6], ['bar', 0.5]])],
  ['jazz', new Map([['club', 1.0], ['theater', 0.85], ['concert_hall', 0.7], ['festival', 0.6], ['bar', 0.5]])],
  ['electronic', new Map([['club', 1.0], ['festival', 0.95], ['warehouse', 0.9], ['concert_hall', 0.6]])],
  ['hip-hop', new Map([['club', 0.9], ['festival', 0.9], ['concert_hall', 0.85], ['theater', 0.6], ['bar', 0.5]])],
  ['country', new Map([['bar', 0.95], ['festival', 0.9], ['theater', 0.7], ['concert_hall', 0.6]])],
  ['classical', new Map([['theater', 1.0], ['concert_hall', 0.95], ['festval', 0.4]])],
  ['blues', new Map([['club', 0.95], ['bar', 0.9], ['theater', 0.7], ['concert_hall', 0.5]])],
  ['indie', new Map([['club', 0.9], ['bar', 0.85], ['festival', 0.8], ['concert_hall', 0.6]])],
  ['latin', new Map([['club', 0.9], ['festival', 0.85], ['concert_hall', 0.7], ['bar', 0.6]])],
  ['folk', new Map([['theater', 0.85], ['bar', 0.8], ['club', 0.7], ['festival', 0.7], ['concert_hall', 0.5]])],
  ['r&b', new Map([['club', 0.85], ['concert_hall', 0.8], ['festival', 0.75], ['theater', 0.6]])],
  ['metal', new Map([['concert_hall', 0.9], ['festival', 0.95], ['club', 0.7]])],
]);

// ─── Seasonal demand coefficients (month 1-12) ─────────────────────────────

// Based on US entertainment industry patterns. Coefficient scales baseline bookings.
const MONTHLY_SEASONALITY: ReadonlyMap<number, number> = new Map([
  [1, 0.75],   // January — post-holiday dip
  [2, 0.80],   // February — Valentine's bump
  [3, 0.95],   // March — spring booking ramp
  [4, 1.05],   // April
  [5, 1.15],   // May — spring festivals
  [6, 1.30],   // June — summer peak starts
  [7, 1.35],   // July — festival season
  [8, 1.30],   // August — still hot
  [9, 1.10],   // September — early fall
  [10, 1.05],  // October — fall events
  [11, 1.15],  // November — holiday party planning
  [12, 1.25],  // December — holiday season
]);

// ─── Rising-star detection constants ────────────────────────────────────────

const MIN_MONTHS_DATA = 3;                    // Minimum months for trend calculation
const RISING_STAR_MIN_GROWTH = 0.05;          // At least 5% monthly growth
const EMERGING_TO_RISING_BOOKING_COUNT = 8;   // Bookings needed to move from emerging to rising
const RISING_TO_ESTABLISHED_BOOKING_COUNT = 25;
const ESTABLISHED_TO_HEADLINER_BOOKING_COUNT = 75;
const TREND_DECAY_WINDOW = 3;                 // Months to look back for trend

// ─── TalentEngine ───────────────────────────────────────────────────────────

export class TalentEngine {
  constructor(private readonly _store: TalentStore) {}

  // ─── Artist → Venue matching ──────────────────────────────────────────────

  /**
   * Find the best venue matches for a given artist.
   * Returns matches sorted by compatibilityScore descending.
   * If venueIds is omitted, all venues for the same tenant are considered.
   */
  matchArtistToVenues(artistId: string, venueIds?: string[]): TalentMatch[] {
    const artist = this.fetchArtist(artistId);
    const venues = this.fetchVenues(venueIds ?? [], artist.tenantId);
    const artistBookings = this.fetchBookings(artistId);

    const matches: TalentMatch[] = [];
    for (const venue of venues) {
      const m = this.scoreArtistVenueMatch(artist, venue, artistBookings);
      matches.push(m);
    }

    return matches.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }

  // ─── Venue → Artist matching ──────────────────────────────────────────────

  /**
   * Find the best artist matches for a given venue.
   * Returns matches sorted by compatibilityScore descending.
   * If artistIds is omitted, all artists for the same tenant are considered.
   */
  matchVenueToArtists(venueId: string, artistIds?: string[]): TalentMatch[] {
    const venue = this.fetchVenue(venueId);
    const artists = this.fetchArtists(artistIds ?? [], venue.tenantId);
    const venueBookings = this.fetchBookings(null, venueId);
    // Build a map of artistId → bookings for the relevant artists
    const relevantArtistIds = artists.map(a => a.id);
    const artistBookingMap = new Map<string, BookingRecord[]>();

    for (const aid of relevantArtistIds) {
      artistBookingMap.set(aid, this.fetchBookings(aid));
    }

    const matches: TalentMatch[] = [];
    for (const artist of artists) {
      const ab = artistBookingMap.get(artist.id) ?? [];
      const m = this.scoreArtistVenueMatch(artist, venue, ab, venueBookings);
      matches.push(m);
    }

    return matches.sort((a, b) => b.compatibilityScore - a.compatibilityScore);
  }

  // ─── Demand prediction ────────────────────────────────────────────────────

  /**
   * Forecast booking demand for an artist or venue over the next N months (default 12).
   * Uses historical booking patterns, seasonality, and trend analysis.
   */
  predictDemand(targetId: string, targetType: 'artist' | 'venue', monthsAhead = 12): DemandForecast {
    const bookings = targetType === 'artist'
      ? this.fetchBookings(targetId)
      : this.fetchBookings(null, targetId);

    // Build monthly booking counts from history
    const monthlyCounts = this.buildMonthlyCounts(bookings);
    const baseline = this.computeBaseline(monthlyCounts);
    const { trend, trendStrength } = this.computeTrend(monthlyCounts);
    const seasonality = this.deriveSeasonality(monthlyCounts);

    const forecast: DemandForecast['forecast'] = [];
    const now = new Date();

    for (let i = 1; i <= monthsAhead; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const monthNum = d.getMonth() + 1;

      // Seasonal coefficient
      const seasonalCoeff = seasonality.find(s => s.month === monthNum)?.coefficient
        ?? MONTHLY_SEASONALITY.get(monthNum) ?? 1.0;

      // Apply trend slope per-month
      const trendSlope = trendStrength * (trend === 'growing' ? 1 : trend === 'declining' ? -1 : 0);
      const trendAdjustment = 1 + trendSlope * (i * 0.1); // gradual slope per month ahead

      const predicted = Math.max(0, Math.round(baseline * seasonalCoeff * trendAdjustment * 100) / 100);

      // Confidence interval widens with time
      const width = 0.1 + (i / monthsAhead) * 0.3; // 10%-40% width
      const low = Math.max(0, Math.round(predicted * (1 - width) * 100) / 100);
      const high = Math.round(predicted * (1 + width) * 100) / 100;

      forecast.push({
        month: monthKey,
        predictedBookings: predicted,
        confidenceLow: low,
        confidenceHigh: high,
      });
    }

    return {
      targetId,
      targetType,
      forecast,
      seasonality,
      trend,
      trendStrength,
    };
  }

  // ─── Career trajectory ────────────────────────────────────────────────────

  /**
   * Analyze an artist's career trajectory based on booking history.
   * Returns stage, frequency trend, rate growth, genre breadth, and 6-month projection.
   */
  getCareerTrajectory(artistId: string): CareerTrajectory {
    const artist = this.fetchArtist(artistId);
    const bookings = this.fetchBookings(artistId);
    const completed = bookings.filter(b => b.status === 'confirmed' || b.status === 'completed');

    // Monthly booking frequency over history
    const monthlyCounts = this.buildMonthlyCounts(completed);
    const bookingFrequency = this.summarizeFrequency(monthlyCounts);

    // Calculate average rate growth (month-over-month % change in average booking revenue)
    const avgRateGrowth = this.computeRateGrowth(completed);

    // Genre breadth — distinct genres from bookings + artist profile
    const genreBreadth = this.computeGenreBreadth(artist, completed);

    // Stage determination
    const totalBookings = completed.length;
    const currentStage = this.determineStage(totalBookings, monthlyCounts);

    // Next stage probability
    const nextStageProbability = this.computeStageAdvancement(currentStage, totalBookings, monthlyCounts);

    // 6-month monthly booking projection
    const projectedMonthlyBookings6m = this.projectNextSixMonths(monthlyCounts);

    return {
      artistId,
      currentStage,
      bookingFrequency,
      avgRateGrowth,
      genreBreadth,
      nextStageProbability,
      projectedMonthlyBookings6m,
    };
  }

  /**
   * Find artists with accelerating booking rates.
   * Ranked by growth rate descending. Default limit 10.
   */
  identifyRisingStars(limit = 10): Array<{
    artistId: string;
    growthRate: number;
    trajectory: CareerTrajectory;
  }> {
    const artists = this.fetchArtists([], null);
    const results: Array<{ artistId: string; growthRate: number; trajectory: CareerTrajectory }> = [];

    for (const artist of artists) {
      if (artist.status !== 'active') continue;

      const trajectory = this.getCareerTrajectory(artist.id);

      // Calculate acceleration: growth rate of booking frequency
      const bookings = this.fetchBookings(artist.id).filter(
        b => b.status === 'confirmed' || b.status === 'completed'
      );
      const monthlyCounts = this.buildMonthlyCounts(bookings);
      const growthRate = this.computeGrowthRate(monthlyCounts);

      // Only qualify if rising
      if (trajectory.currentStage === 'declining') continue;
      if (growthRate < RISING_STAR_MIN_GROWTH) continue;

      results.push({
        artistId: artist.id,
        growthRate,
        trajectory,
      });
    }

    results.sort((a, b) => b.growthRate - a.growthRate);
    return results.slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Private scoring: Artist-Venue Match ──────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  private scoreArtistVenueMatch(
    artist: ArtistProfile,
    venue: VenueProfile,
    artistBookings: BookingRecord[],
    venueBookings: BookingRecord[] = [],
  ): TalentMatch {
    const genreFit = this.scoreGenreFit(artist, venue);
    const capacityFit = this.scoreCapacityFit(artist, venue, artistBookings);
    const priceFit = this.scorePriceFit(artist, venue, artistBookings, venueBookings);
    const geographicFit = this.scoreGeographicFit(artist, venue);
    const historicalSuccess = this.scoreHistoricalSuccess(artist, venue, artistBookings, venueBookings);

    const total = Math.round(genreFit + capacityFit + priceFit + geographicFit + historicalSuccess);
    const clamped = Math.min(100, Math.max(0, total));

    const recommendation = clamped >= 80 ? 'strong_match'
      : clamped >= 60 ? 'good_match'
        : clamped >= 40 ? 'possible_match'
          : 'not_recommended';

    const expectedDraw = this.estimateExpectedDraw(artist, venue, artistBookings);
    const recommendedPriceCents = this.recommendPrice(artist, venue, artistBookings);

    return {
      artistId: artist.id,
      venueId: venue.id,
      compatibilityScore: clamped,
      factors: { genreFit, capacityFit, priceFit, geographicFit, historicalSuccess },
      recommendation,
      expectedDraw,
      recommendedPriceCents,
    };
  }

  // ── Genre fit (0-25) ─────────────────────────────────────────────────────

  private scoreGenreFit(artist: ArtistProfile, venue: VenueProfile): number {
    if (!venue.venueType || artist.genres.length === 0) {
      return 12.5; // Neutral score when data is missing
    }

    const venueTypeLower = venue.venueType.toLowerCase();
    let bestFit = 0;

    for (const genre of artist.genres) {
      const compat = GENRE_VENUE_COMPATIBILITY.get(genre.toLowerCase());
      if (!compat) continue;

      const fit = compat.get(venueTypeLower) ?? 0;
      bestFit = Math.max(bestFit, fit);
    }

    if (bestFit === 0) return 5; // No genre overlap found

    return Math.round(bestFit * 25);
  }

  // ── Capacity fit (0-25) ──────────────────────────────────────────────────

  private scoreCapacityFit(
    artist: ArtistProfile,
    venue: VenueProfile,
    _artistBookings: BookingRecord[],
  ): number {
    if (!venue.capacity || venue.capacity <= 0) return 12.5;

    // Estimate artist's typical draw from booking patterns
    const typicalDraw = this.estimateTypicalDraw(artist);
    if (typicalDraw <= 0) return 12.5;

    // Ideal ratio is artist draw fills 60-90% of venue capacity.
    // Score 25 if ratio is 0.6-0.9, decreasing as ratio goes further.
    const ratio = typicalDraw / venue.capacity;

    if (ratio >= 0.6 && ratio <= 0.9) return 25;
    if (ratio >= 0.4 && ratio < 0.6) return Math.round(15 + (ratio - 0.4) * 50);
    if (ratio > 0.9 && ratio <= 1.2) return Math.round(20 - (ratio - 0.9) * 20);
    if (ratio > 1.2 && ratio <= 1.5) return Math.round(15 - (ratio - 1.2) * 33);
    return Math.max(0, Math.round(5 * (1 - Math.abs(ratio - 0.75))));
  }

  // ── Price fit (0-20) ─────────────────────────────────────────────────────

  private scorePriceFit(
    artist: ArtistProfile,
    _venue: VenueProfile,
    artistBookings: BookingRecord[],
    venueBookings: BookingRecord[],
  ): number {
    const artistAvgRate = this.computeArtistAvgRate(artist, artistBookings);
    if (artistAvgRate <= 0) return 10;

    // Check against venue's typical booking amounts
    const venueAvgBudget = venueBookings.length > 0
      ? this.computeVenueAvgBudget(venueBookings)
      : artistAvgRate; // No venue data, assume similar

    if (venueAvgBudget <= 0) return 10;

    const ratio = artistAvgRate / venueAvgBudget;

    // Perfect fit: artist asks 80-120% of venue's typical budget
    if (ratio >= 0.8 && ratio <= 1.2) return 20;
    if (ratio >= 0.6 && ratio < 0.8) return Math.round(15 + (ratio - 0.6) * 25);
    if (ratio > 1.2 && ratio <= 1.5) return Math.round(15 - (ratio - 1.2) * 20);
    return Math.max(0, Math.round(Math.min(10, 10 * (1 - Math.abs(ratio - 1.0)))));
  }

  // ── Geographic fit (0-15) ────────────────────────────────────────────────

  private scoreGeographicFit(artist: ArtistProfile, venue: VenueProfile): number {
    if (!artist.travelRadiusMiles || !venue.city || !artist.genres.length) {
      return 7.5;
    }

    // Simplified: if artist has a travel radius, check if venue is likely accessible.
    // Without actual coordinates, use a heuristic: if travel radius >= 100 miles,
    // assume high geographic flexibility.
    const radius = artist.travelRadiusMiles;
    if (radius >= 500) return 15;
    if (radius >= 300) return 13;
    if (radius >= 100) return 10;
    return Math.max(2, Math.round(radius / 15)); // 0-15 scale
  }

  // ── Historical success (0-15) ────────────────────────────────────────────

  private scoreHistoricalSuccess(
    _artist: ArtistProfile,
    venue: VenueProfile,
    artistBookings: BookingRecord[],
    venueBookings: BookingRecord[],
  ): number {
    const venueBookedArtists = new Set<string>();
    for (const b of venueBookings) {
      if (b.artistId) venueBookedArtists.add(b.artistId);
    }

    // Check if this artist has booked at this venue or similar venues
    const artistVenueIds = new Set<string>();
    for (const b of artistBookings) {
      if (b.venueId) artistVenueIds.add(b.venueId);
    }

    // Direct match: artist performed at this venue before
    if (artistVenueIds.has(venue.id)) {
      // Check if past booking was successful (confirmed/completed)
      const pastBookings = artistBookings.filter(
        b => b.venueId === venue.id && (b.status === 'confirmed' || b.status === 'completed'),
      );
      if (pastBookings.length > 0) {
        return Math.min(15, 10 + pastBookings.length * 2);
      }
    }

    // Related venue match: artist performed at venues with similar type
    // Proxy: if venue has bookings from similar genre artists with good outcomes
    const completedVenueBookings = venueBookings.filter(
      b => (b.status === 'confirmed' || b.status === 'completed') && b.artistId,
    );

    if (completedVenueBookings.length >= 3) {
      // Venue has proven track record with artists — moderate score
      return Math.min(12, 6 + Math.min(6, Math.floor(completedVenueBookings.length / 2) * 2));
    }

    return completedVenueBookings.length > 0 ? 4 : 2;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Private: Demand & Trend Analysis Helpers ─────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /** Build a map of YYYY-MM → count from booking records. */
  private buildMonthlyCounts(bookings: BookingRecord[]): Map<string, number> {
    const counts = new Map<string, number>();

    for (const b of bookings) {
      const date = new Date(b.eventDate ? b.eventDate : b.createdAt);
      if (isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return counts;
  }

  /** Compute average monthly booking count (baseline). */
  private computeBaseline(monthlyCounts: Map<string, number>): number {
    if (monthlyCounts.size === 0) return 0;
    const sum = Array.from(monthlyCounts.values()).reduce((a, b) => a + b, 0);
    return Math.round((sum / monthlyCounts.size) * 100) / 100;
  }

  /**
   * Compute trend from monthly booking counts.
   * Uses linear regression slope on the last N months of data.
   */
  private computeTrend(monthlyCounts: Map<string, number>): {
    trend: 'growing' | 'stable' | 'declining';
    trendStrength: number;
  } {
    if (monthlyCounts.size < 2) {
      return { trend: 'stable', trendStrength: 0 };
    }

    const entries = Array.from(monthlyCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count], i) => ({ month, count, index: i }));

    const n = entries.length;

    if (n < 2) return { trend: 'stable', trendStrength: 0 };

    // Simple linear regression: slope = (n*sum(x*y) - sum(x)*sum(y)) / (n*sum(x^2) - (sum(x))^2)
    let sumX = 0, sumY = 0, sumXY = 0, sumSqX = 0;
    for (const e of entries) {
      sumX += e.index;
      sumY += e.count;
      sumXY += e.index * e.count;
      sumSqX += e.index * e.index;
    }

    const denom = n * sumSqX - sumX * sumX;
    if (denom === 0) return { trend: 'stable', trendStrength: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const avgY = sumY / n;

    // Normalize slope relative to mean to get strength 0-1
    const normalizedSlope = avgY > 0 ? Math.abs(slope) / avgY : 0;
    const trendStrength = Math.min(1.0, Math.max(0, Math.round(normalizedSlope * 100) / 100));

    // Threshold for considering direction meaningful
    const growing = slope > 0.1 && normalizedSlope > 0.05;
    const declining = slope < -0.1 && normalizedSlope > 0.05;

    return {
      trend: growing ? 'growing' : declining ? 'declining' : 'stable',
      trendStrength,
    };
  }

  /**
   * Derive seasonality coefficients from actual booking data.
   * Falls back to industry defaults for months with no data.
   */
  private deriveSeasonality(monthlyCounts: Map<string, number>): Array<{ month: number; coefficient: number }> {
    // Aggregate counts by month-of-year across all years
    const yearMonthlyAgg = new Map<number, number>();
    const yearMonthlyTotal = new Map<number, number>();

    for (const [key, count] of monthlyCounts) {
      const monthNum = parseInt(key.slice(5, 7), 10);
      yearMonthlyAgg.set(monthNum, (yearMonthlyAgg.get(monthNum) ?? 0) + count);
      yearMonthlyTotal.set(monthNum, (yearMonthlyTotal.get(monthNum) ?? 1) + 1);
    }

    const totalMean = this.computeBaseline(monthlyCounts);
    if (totalMean <= 0) {
      // Return industry defaults
      const seasonality: Array<{ month: number; coefficient: number }> = [];
      for (let m = 1; m <= 12; m++) {
        seasonality.push({ month: m, coefficient: MONTHLY_SEASONALITY.get(m) ?? 1.0 });
      }
      return seasonality;
    }

    const seasonality: Array<{ month: number; coefficient: number }> = [];
    for (let m = 1; m <= 12; m++) {
      const avgCount = (yearMonthlyAgg.get(m) ?? 0) / Math.max(1, yearMonthlyTotal.get(m) ?? 1);
      const coefficient = avgCount / totalMean;
      seasonality.push({
        month: m,
        coefficient: Math.round(coefficient * 100) / 100,
      });
    }

    // Fill any zero coefficients with industry defaults
    for (const s of seasonality) {
      if (s.coefficient === 0) {
        s.coefficient = MONTHLY_SEASONALITY.get(s.month) ?? 1.0;
      }
    }

    return seasonality;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Private: Career Trajectory Helpers ───────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  /** Summarize monthly counts into a frequency array. */
  private summarizeFrequency(monthlyCounts: Map<string, number>): Array<{ month: string; count: number }> {
    const freq: Array<{ month: string; count: number }> = [];

    for (const [month, count] of monthlyCounts) {
      freq.push({ month, count });
    }

    freq.sort((a, b) => a.month.localeCompare(b.month));
    return freq;
  }

  /**
   * Compute month-over-month rate growth % from booking amounts.
   * Returns average monthly % change.
   */
  private computeRateGrowth(bookings: BookingRecord[]): number {
    // Group by month, compute average amount per month
    const monthlyTotals = new Map<string, number>();
    const monthlyCounts = new Map<string, number>();

    for (const b of bookings) {
      const amt = b.totalAmountCents ?? b.quotedAmountCents ?? 0;
      if (amt <= 0) continue;
      const date = new Date(b.eventDate ? b.eventDate : b.createdAt);
      if (isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthlyTotals.set(key, (monthlyTotals.get(key) ?? 0) + amt);
      monthlyCounts.set(key, (monthlyCounts.get(key) ?? 0) + 1);
    }

    // Average per month
    const monthlyAvgs: Array<{ key: string; avg: number }> = [];
    for (const [key, total] of monthlyTotals) {
      const count = monthlyCounts.get(key) ?? 1;
      monthlyAvgs.push({ key, avg: total / count });
    }

    monthlyAvgs.sort((a, b) => a.key.localeCompare(b.key));

    if (monthlyAvgs.length < 2) return 0;

    // Percentage change between consecutive months
    const changes: number[] = [];
    for (let i = 1; i < monthlyAvgs.length; i++) {
      const prev = monthlyAvgs[i - 1].avg;
      const curr = monthlyAvgs[i].avg;
      if (prev > 0) {
        changes.push((curr - prev) / prev);
      }
    }

    if (changes.length === 0) return 0;
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
    // Return as percentage
    return Math.round(avgChange * 10000) / 100;
  }

  /** Count distinct genres from artist profile + completed bookings. */
  private computeGenreBreadth(artist: ArtistProfile, bookings: BookingRecord[]): number {
    const genres = new Set<string>(artist.genres.map(g => g.toLowerCase()));

    for (const b of bookings) {
      const eventGenre = b.metadata?.genre;
      if (typeof eventGenre === 'string') {
        genres.add(eventGenre.toLowerCase());
      }
    }

    return genres.size;
  }

  /** Determine artist stage from total bookings and frequency data. */
  private determineStage(totalBookings: number, monthlyCounts: Map<string, number>): CareerTrajectory['currentStage'] {
    const { trend } = this.computeTrend(monthlyCounts);

    if (trend === 'declining' && totalBookings > RISING_TO_ESTABLISHED_BOOKING_COUNT && monthlyCounts.size >= MIN_MONTHS_DATA) {
      return 'declining';
    }

    if (totalBookings >= ESTABLISHED_TO_HEADLINER_BOOKING_COUNT) return 'headliner';
    if (totalBookings >= RISING_TO_ESTABLISHED_BOOKING_COUNT) return 'established';
    if (totalBookings >= EMERGING_TO_RISING_BOOKING_COUNT) return 'rising';

    return 'emerging';
  }

  /** Estimate probability of advancing to next career stage. */
  private computeStageAdvancement(
    currentStage: string,
    totalBookings: number,
    monthlyCounts: Map<string, number>,
  ): number {
    const { trend, trendStrength } = this.computeTrend(monthlyCounts);

    let threshold: number;
    switch (currentStage) {
      case 'emerging':
        threshold = EMERGING_TO_RISING_BOOKING_COUNT;
        break;
      case 'rising':
        threshold = RISING_TO_ESTABLISHED_BOOKING_COUNT;
        break;
      case 'established':
        threshold = ESTABLISHED_TO_HEADLINER_BOOKING_COUNT;
        break;
      default:
        return 0; // headliner/declining have no further stage
    }

    if (totalBookings <= 0) return 0;

    // Ratio of how close to threshold, boosted by trend momentum
    const closeness = totalBookings / threshold;
    if (closeness >= 1.0) return 1.0;

    // Trend multiplier: growing boosts, declining reduces
    const trendMult = trend === 'growing' ? 1.0 + trendStrength
      : trend === 'declining' ? 1.0 - trendStrength
        : 1.0;

    return Math.min(1.0, Math.max(0, Math.round(closeness * trendMult * 100) / 100));
  }

  /** Project average monthly bookings for next 6 months. */
  private projectNextSixMonths(monthlyCounts: Map<string, number>): number {
    if (monthlyCounts.size === 0) return 0;

    const entries = Array.from(monthlyCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    // Use last TREND_DECAY_WINDOW months for projection
    const recent = entries.slice(-TREND_DECAY_WINDOW);
    const recentAvg = recent.reduce((sum, [, c]) => sum + c, 0) / recent.length;

    // Apply trend adjustment
    const { trend, trendStrength } = this.computeTrend(monthlyCounts);
    const trendSlope = trend === 'growing' ? 0.05
      : trend === 'declining' ? -0.05
        : 0;

    const adjusted = recentAvg * (1 + trendSlope * trendStrength * 3);
    return Math.max(0, Math.round(adjusted * 100) / 100);
  }

  // Compute compound monthly growth rate
  private computeGrowthRate(monthlyCounts: Map<string, number>): number {
    const entries = Array.from(monthlyCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));

    if (entries.length < 2) return 0;

    const recent = entries.slice(-Math.max(2, Math.ceil(entries.length / 2)));
    if (recent.length < 2) return 0;

    const firstVal = recent[0][1];
    const lastVal = recent[recent.length - 1][1];

    if (firstVal <= 0) return lastVal > 0 ? 1 : 0;

    // CAGR-like: ((last/first)^(1/periods) - 1)
    const periods = recent.length - 1;
    const cagr = Math.pow(lastVal / firstVal, 1 / periods) - 1;
    return Math.round(cagr * 10000) / 10000;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Private: Estimation Helpers ──────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  private estimateTypicalDraw(artist: ArtistProfile): number {
    const draw = artist.genres.length > 0
      ? this.getGenreTypicalDraw(artist.genres)
      : 100; // Default draw estimate
    return draw;
  }

  private getGenreTypicalDraw(genres: string[]): number {
    // Typical audience sizes per genre (approximate industry averages)
    const genreDraws: ReadonlyMap<string, number> = new Map([
      ['rock', 500],
      ['pop', 800],
      ['jazz', 150],
      ['electronic', 600],
      ['hip-hop', 700],
      ['country', 300],
      ['classical', 200],
      ['blues', 120],
      ['indie', 250],
      ['latin', 400],
      ['folk', 100],
      ['r&b', 350],
      ['metal', 400],
    ]);

    let total = 0;
    let count = 0;
    for (const g of genres) {
      const d = genreDraws.get(g.toLowerCase());
      if (d != null) {
        total += d;
        count++;
      }
    }
    return count > 0 ? Math.round(total / count) : 100;
  }

  private computeArtistAvgRate(artist: ArtistProfile, bookings: BookingRecord[]): number {
    if (bookings.length === 0 && artist.hourlyRateCents != null && artist.hourlyRateCents > 0) {
      return artist.hourlyRateCents * 4; // Assume ~4 hour set
    }

    const amounts = bookings
      .filter(b => (b.totalAmountCents ?? 0) > 0)
      .map(b => b.totalAmountCents ?? 0);

    if (amounts.length === 0) {
      return artist.hourlyRateCents != null ? artist.hourlyRateCents * 4 : 50_000;
    }

    return Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
  }

  private computeVenueAvgBudget(bookings: BookingRecord[]): number {
    const amounts = bookings
      .filter(b => (b.totalAmountCents ?? 0) > 0)
      .map(b => b.totalAmountCents ?? 0);

    if (amounts.length === 0) return 0;
    return Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length);
  }

  private estimateExpectedDraw(
    artist: ArtistProfile,
    venue: VenueProfile,
    artistBookings: BookingRecord[],
  ): number {
    const typicalDraw = this.estimateTypicalDraw(artist);

    // Cap expected draw at venue capacity
    const venueCap = venue.capacity ?? Infinity;
    return Math.min(typicalDraw, venueCap);
  }

  private recommendPrice(artist: ArtistProfile, _venue: VenueProfile, artistBookings: BookingRecord[]): number {
    const avgRate = this.computeArtistAvgRate(artist, artistBookings);

    // If we have historical data, recommend slightly above average (5% buffer)
    if (artistBookings.length >= 3) {
      return Math.round(avgRate * 1.05);
    }

    return avgRate;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ─── Private: Data Fetching ───────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  private fetchArtist(artistId: string): ArtistProfile {
    const artists = this._store.getArtists([artistId]);
    if (artists.length === 0) {
      throw new Error(`Artist not found: ${artistId}`);
    }
    return artists[0];
  }

  private fetchVenue(venueId: string): VenueProfile {
    const venues = this._store.getVenues([venueId]);
    if (venues.length === 0) {
      throw new Error(`Venue not found: ${venueId}`);
    }
    return venues[0];
  }

  private fetchArtists(artistIds: string[], tenantId: string | null): ArtistProfile[] {
    if (artistIds.length > 0) {
      return this._store.getArtists(artistIds).filter(
        a => !tenantId || a.tenantId === tenantId,
      );
    }

    // Fetch all; filter by tenant if provided
    const all = this._store.getArtists();
    return !tenantId ? all : all.filter(a => a.tenantId === tenantId);
  }

  private fetchVenues(venueIds: string[], tenantId: string | null): VenueProfile[] {
    if (venueIds.length > 0) {
      return this._store.getVenues(venueIds).filter(
        v => !tenantId || v.tenantId === tenantId,
      );
    }

    const all = this._store.getVenues();
    return !tenantId ? all : all.filter(v => v.tenantId === tenantId);
  }

  private fetchBookings(artistId: string | null = null, venueId: string | null = null): BookingRecord[] {
    return this._store.getBookings(artistId, venueId);
  }
}
