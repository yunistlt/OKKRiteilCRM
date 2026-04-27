import React from 'react';

interface FAQ {
  intent_slug: string;
  category: string;
  question_variants: string[];
  answer_website: string;
  frequency_score: number;
  type: string;
  tags: string[];
}

interface FAQAccordionProps {
  faqs: FAQ[];
}

export const FAQAccordion: React.FC<FAQAccordionProps> = ({ faqs }) => {
  // Группировка по категориям
  const grouped = faqs.reduce<Record<string, FAQ[]>>((acc, faq) => {
    acc[faq.category] = acc[faq.category] || [];
    acc[faq.category].push(faq);
    return acc;
  }, {});

  return (
    <div>
      {Object.entries(grouped).map(([category, items]) => (
        <div key={category} style={{ marginBottom: 24 }}>
          <h3>{category}</h3>
          <div>
            {items.map((faq) => (
              <details key={faq.intent_slug} style={{ marginBottom: 8 }}>
                <summary>{faq.question_variants[0]}</summary>
                <div>{faq.answer_website}</div>
              </details>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
