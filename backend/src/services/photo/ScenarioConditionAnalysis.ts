/** Existing hackathon scenario analysis, kept separate from the model adapter. */
export function analyzeScenarioCondition(submission: any): any[] {
  const results: any[] = [];
  const photoSlotsMap: Record<string, string> = {
    front: '車頭',
    right_side: '右側',
    rear: '車尾',
    left_side: '左側',
    front_interior: '前座內裝',
    backseat_interior: '後座內裝',
  };

  for (const photo of submission.photos || []) {
    const slot = photo.slot || 'front';
    const text = `${photo.filename || ''} ${slot} ${photo.note || ''}`.toLowerCase();
    const isInterior = slot === 'front_interior' || slot === 'backseat_interior';
    const quality = photo.qualityPassed !== false;

    if (isInterior) {
      const dirty = text.includes('dirty') || text.includes('trash') || text.includes('stain') || text.includes('髒') || text.includes('垃圾');
      results.push({
        slot,
        qualityPassed: quality,
        damageDetected: false,
        cleanliness: dirty ? 'dirty' : 'normal',
        confidence: dirty ? 0.89 : 0.93
      });
    } else {
      const damaged = text.includes('scratch') || text.includes('dent') || text.includes('damage') || text.includes('crack') || text.includes('擦傷') || text.includes('凹') || text.includes('破');
      results.push({
        slot,
        qualityPassed: quality,
        damageDetected: damaged,
        damageType: damaged ? 'scratch' : null,
        damageLocation: photoSlotsMap[slot] || slot,
        isNewDamage: damaged && submission.phase === 'return',
        confidence: damaged ? 0.88 : 0.92
      });
    }
  }
  return results;
}
