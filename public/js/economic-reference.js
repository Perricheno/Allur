// Reference scenario, not a KTZ supply contract. Every default exposes provenance.
export const ECONOMIC_REFERENCE = {
  dieselGrade: 'summer', dieselLitresH: 15.14, electricKwhH: 20,
  dieselPrice: 330, electricPrice: 50.03, locoHour: 0, wagonHour: 0,
};
export const ECONOMIC_SOURCES = [
  { label: 'Дизель: 330 ₸/л', note: 'Средняя розничная цена, выведенная из сообщения Минэнерго 2026: 281 + 49. Ориентир, не закупочная цена КТЖ.', url: 'https://www.gov.kz/memleket/entities/energo/press/news/details/1227140?lang=ru' },
  { label: 'Дизель на холостом ходу: 15,14 л/ч', note: 'Середина диапазона EPA 3–5 US gal/h; 4 × 3,78541. Зарубежный ориентир, не норма конкретной серии. Диапазон 11,36–18,93 л/ч.', url: 'https://www.epa.gov/ports-initiative/rail-facility-best-practices-improve-air-quality' },
  { label: 'Электричество: 50,03 ₸/кВт·ч', note: 'Тариф небытовых потребителей Алматы с НДС с 12.09.2026. Региональный ориентир, не договор тягового электроснабжения КТЖ.', url: 'https://esalmaty.kz/ru/business-tariffs' },
  { label: 'Собственные нужды электровоза: 20 кВт', note: 'Инженерное допущение сценария, подтверждённая норма для конкретной серии пока не найдена. Проверять чувствительность к диапазону 10–40 кВт.', url: null },
];
