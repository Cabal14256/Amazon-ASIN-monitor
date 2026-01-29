export const AMAZON_DOMAIN_MAP: Record<string, string> = {
  US: 'amazon.com',
  CA: 'amazon.ca',
  MX: 'amazon.com.mx',
  BR: 'amazon.com.br',
  UK: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
  NL: 'amazon.nl',
  SE: 'amazon.se',
  PL: 'amazon.pl',
  BE: 'amazon.com.be',
  TR: 'amazon.com.tr',
  AE: 'amazon.ae',
  SA: 'amazon.sa',
  IN: 'amazon.in',
  SG: 'amazon.sg',
  AU: 'amazon.com.au',
  JP: 'amazon.co.jp',
  EG: 'amazon.eg',
};

const normalizeDomain = (site?: string) => {
  if (!site) {
    return '';
  }
  const trimmed = site.trim();
  if (!trimmed) {
    return '';
  }
  const withoutScheme = trimmed.replace(/^https?:\/\//i, '');
  const domain = withoutScheme.split('/')[0];
  if (!domain || !domain.includes('.') || !/[a-z]/i.test(domain)) {
    return '';
  }
  return domain;
};

export const buildAmazonProductUrl = (
  asin?: string,
  country?: string,
  site?: string,
) => {
  if (!asin) {
    return '';
  }
  const trimmedAsin = asin.trim();
  if (!trimmedAsin) {
    return '';
  }
  const siteDomain = normalizeDomain(site);
  if (siteDomain) {
    return `https://${siteDomain}/dp/${trimmedAsin}`;
  }
  const domain = country ? AMAZON_DOMAIN_MAP[country] : '';
  return domain ? `https://${domain}/dp/${trimmedAsin}` : '';
};
