const DELIVERY_RATES = [
  { code: '01', wilaya: 'Adrar', home: 1100, stopDesk: 600 },
  { code: '02', wilaya: 'Chlef', home: 700, stopDesk: 400 },
  { code: '03', wilaya: 'Laghouat', home: 900, stopDesk: 500 },
  { code: '04', wilaya: 'Oum El Bouaghi', home: 800, stopDesk: 400, aliases: ['Oum Bouaghi'] },
  { code: '05', wilaya: 'Batna', home: 800, stopDesk: 400 },
  { code: '06', wilaya: 'Bejaia', home: 700, stopDesk: 400, aliases: ['Béjaïa', 'Bejaïa'] },
  { code: '07', wilaya: 'Biskra', home: 900, stopDesk: 500 },
  { code: '08', wilaya: 'Bechar', home: 1100, stopDesk: 600, aliases: ['Béchar'] },
  { code: '09', wilaya: 'Blida', home: 500, stopDesk: 250 },
  { code: '10', wilaya: 'Bouira', home: 650, stopDesk: 400 },
  { code: '11', wilaya: 'Tamanrasset', home: 1300, stopDesk: 800 },
  { code: '12', wilaya: 'Tebessa', home: 800, stopDesk: 500, aliases: ['Tébessa'] },
  { code: '13', wilaya: 'Tlemcen', home: 800, stopDesk: 400 },
  { code: '14', wilaya: 'Tiaret', home: 800, stopDesk: 400 },
  { code: '15', wilaya: 'Tizi Ouzou', home: 650, stopDesk: 400 },
  { code: '16', wilaya: 'Alger', home: 400, stopDesk: 200, aliases: ['Algiers', 'Dzayer', 'الجزائر', 'دزاير'] },
  { code: '17', wilaya: 'Djelfa', home: 900, stopDesk: 500 },
  { code: '18', wilaya: 'Jijel', home: 700, stopDesk: 400 },
  { code: '19', wilaya: 'Setif', home: 700, stopDesk: 400, aliases: ['Sétif'] },
  { code: '20', wilaya: 'Saida', home: 800, stopDesk: 400, aliases: ['Saïda'] },
  { code: '21', wilaya: 'Skikda', home: 700, stopDesk: 400 },
  { code: '22', wilaya: 'Sidi Bel Abbes', home: 700, stopDesk: 400, aliases: ['Sidi Bel Abbès', 'Sidi Bel Abbes'] },
  { code: '23', wilaya: 'Annaba', home: 700, stopDesk: 400 },
  { code: '24', wilaya: 'Guelma', home: 800, stopDesk: 400 },
  { code: '25', wilaya: 'Constantine', home: 700, stopDesk: 400 },
  { code: '26', wilaya: 'Medea', home: 600, stopDesk: 400, aliases: ['Médéa'] },
  { code: '27', wilaya: 'Mostaganem', home: 700, stopDesk: 400 },
  { code: '28', wilaya: "M'Sila", home: 800, stopDesk: 500, aliases: ['Msila', 'M Sila'] },
  { code: '29', wilaya: 'Mascara', home: 700, stopDesk: 400 },
  { code: '30', wilaya: 'Ouargla', home: 1000, stopDesk: 500 },
  { code: '31', wilaya: 'Oran', home: 700, stopDesk: 400, aliases: ['وهران'] },
  { code: '32', wilaya: 'El Bayadh', home: 1000, stopDesk: 500 },
  { code: '33', wilaya: 'Illizi', home: 1300, stopDesk: 600 },
  { code: '34', wilaya: 'Bordj Bou Arreridj', home: 700, stopDesk: 400, aliases: ['BBA', 'Bordj'] },
  { code: '35', wilaya: 'Boumerdes', home: 600, stopDesk: 350, aliases: ['Boumerdès'] },
  { code: '36', wilaya: 'El Tarf', home: 800, stopDesk: 400 },
  { code: '37', wilaya: 'Tindouf', home: 1300, stopDesk: 600 },
  { code: '38', wilaya: 'Tissemsilt', home: 800, stopDesk: 400 },
  { code: '39', wilaya: 'El Oued', home: 900, stopDesk: 500 },
  { code: '40', wilaya: 'Khenchela', home: 800, stopDesk: 500 },
  { code: '41', wilaya: 'Souk Ahras', home: 800, stopDesk: 500 },
  { code: '42', wilaya: 'Tipaza', home: 600, stopDesk: 350 },
  { code: '43', wilaya: 'Mila', home: 700, stopDesk: 400 },
  { code: '44', wilaya: 'Ain Defla', home: 600, stopDesk: 400, aliases: ['Aïn Defla', 'Ain Defla'] },
  { code: '45', wilaya: 'Naama', home: 1000, stopDesk: 500, aliases: ['Naâma'] },
  { code: '46', wilaya: 'Ain Temouchent', home: 700, stopDesk: 400, aliases: ['Aïn Témouchent', 'Ain Temouchent'] },
  { code: '47', wilaya: 'Ghardaia', home: 1000, stopDesk: 500, aliases: ['Ghardaïa'] },
  { code: '48', wilaya: 'Relizane', home: 700, stopDesk: 400 },
  { code: '49', wilaya: 'Timimoun', home: 1300, stopDesk: 600 },
  { code: '51', wilaya: 'Ouled Djellal', home: 900, stopDesk: 500 },
  { code: '52', wilaya: 'Beni Abbes', home: 1300, stopDesk: null, aliases: ['Beni Abbès'] },
  { code: '53', wilaya: 'In Salah', home: 1300, stopDesk: 600 },
  { code: '55', wilaya: 'Touggourt', home: 900, stopDesk: 500 },
  { code: '57', wilaya: "El M'Ghair", home: 900, stopDesk: null, aliases: ['El Meghair', 'El MGhair'] },
  { code: '58', wilaya: 'El Meniaa', home: 1000, stopDesk: 500 },
];

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

function findDeliveryRate(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  for (const rate of DELIVERY_RATES) {
    const names = [rate.wilaya, rate.code, ...(rate.aliases || [])];
    if (names.some((name) => {
      const n = normalizeText(name);
      return n && new RegExp(`(^|\\s)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(normalized);
    })) {
      return rate;
    }
  }

  return null;
}

function formatDa(amount) {
  return amount == null ? 'غير متوفر' : `${amount} دج`;
}

function formatDeliveryReply(rate, lang = 'dz') {
  if (!rate) {
    return lang === 'fr'
      ? 'La livraison dépend de la wilaya. Donnez-moi votre wilaya.'
      : 'التوصيل حسب الولاية. ابعثلي الولاية تاعك.';
  }

  const stopDesk = rate.stopDesk == null
    ? (lang === 'fr' ? 'non disponible' : 'غير متوفر')
    : `${rate.stopDesk} DA`;

  if (lang === 'fr') {
    return `${rate.wilaya}: à domicile ${rate.home} DA، stop desk ${stopDesk}.`;
  }

  return `${rate.wilaya}: للدار ${formatDa(rate.home)}، وستوب ديسك ${rate.stopDesk == null ? 'غير متوفر' : formatDa(rate.stopDesk)}.`;
}

function deliverySummaryLines() {
  return DELIVERY_RATES.map((rate) => {
    const stopDesk = rate.stopDesk == null ? 'Non disponible' : `${rate.stopDesk} DA`;
    return `${rate.code} ${rate.wilaya}: home ${rate.home} DA, stop desk ${stopDesk}`;
  });
}

module.exports = {
  DELIVERY_RATES,
  findDeliveryRate,
  formatDeliveryReply,
  deliverySummaryLines,
};
