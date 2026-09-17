import { DatabaseRepository } from '../repositories/DatabaseRepository';
import fs from 'fs';
import path from 'path';

export interface AiAgentAnswer {
  title: string;
  insight: string;
  recommendation: string;
  evidence: string;
}

export interface VisionReview {
  comparisonType: 'new_damage' | 'existing_damage' | 'dirt' | 'quality_issue' | 'no_material_change' | 'uncertain';
  decision: 'pass' | 'needs_more_evidence' | 'human_review';
  confidence: number;
  summary: string;
  suspectedRegions: Array<{ label: string; description: string }>;
  evidence: string[];
}

const DEFAULT_MODEL = 'gemini-3.8-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export class AiAgentService {
  constructor(private repo: DatabaseRepository, private secretFile: string) {}

  private readDashboardKey() {
    try {
      return fs.readFileSync(this.secretFile, 'utf8').trim();
    } catch {
      return '';
    }
  }

  private getCredentials() {
    return {
      apiKey: process.env.GEMINI_API_KEY?.trim() || this.readDashboardKey(),
      model: process.env.GEMINI_MODEL?.trim() || this.repo.getSetting('geminiModel', DEFAULT_MODEL)
    };
  }

  private extractText(payload: any) {
    const direct = payload?.output_text ?? payload?.interaction?.output_text;
    if (typeof direct === 'string') return direct.trim();
    return '';
  }

  private async generate(apiKey: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(body)
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new Error(payload?.error?.message || `Gemini API request failed (${response.status})`);
    const outputText = this.extractText(payload);
    if (!outputText) {
      const blockReason = payload?.promptFeedback?.blockReason;
      throw new Error(blockReason ? `Gemini blocked the request (${blockReason}).` : 'Gemini API did not return text output.');
    }
    return outputText;
  }

  public getConfig() {
    const environmentKey = Boolean(process.env.GEMINI_API_KEY?.trim());
    return {
      provider: 'google-gemini' as const,
      model: process.env.GEMINI_MODEL?.trim() || this.repo.getSetting('geminiModel', DEFAULT_MODEL),
      keyConfigured: environmentKey || Boolean(this.readDashboardKey()),
      keySource: environmentKey ? 'environment' as const : 'dashboard' as const
    };
  }

  public updateSettings(input: { apiKey?: string; model?: string; clearApiKey?: boolean }) {
    if (input.model !== undefined) this.repo.setSetting('geminiModel', input.model.trim());
    if (input.clearApiKey) {
      if (fs.existsSync(this.secretFile)) fs.unlinkSync(this.secretFile);
    } else if (input.apiKey?.trim()) {
      fs.mkdirSync(path.dirname(this.secretFile), { recursive: true });
      fs.writeFileSync(this.secretFile, input.apiKey.trim(), { encoding: 'utf8', mode: 0o600 });
    }
  }

  public async analyze(prompt: string, context: unknown): Promise<{ answer: AiAgentAnswer; model: string }> {
    const { apiKey, model } = this.getCredentials();
    if (!apiKey) throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
    const schema = {
      type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string' }, insight: { type: 'string' },
        recommendation: { type: 'string' }, evidence: { type: 'string' }
      },
      required: ['title', 'insight', 'recommendation', 'evidence']
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const outputText = await this.generate(apiKey, {
        model,
        input: [
          '你是 iRent 營運中心的 AI Operations Copilot。',
          '只根據提供的即時營運資料回答，不得虛構數字、預測或已執行的動作。',
          '請使用繁體中文，並遵守指定的 JSON schema。',
          `使用者問題：${prompt}`,
          `即時營運資料：${JSON.stringify(context)}`
        ].join('\n'),
        response_format: { type: 'text', mime_type: 'application/json', schema }
      }, controller.signal);

      try {
        const parsed = JSON.parse(outputText.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        if (['title', 'insight', 'recommendation', 'evidence'].every(key => typeof parsed[key] === 'string')) {
          return { answer: parsed as AiAgentAnswer, model };
        }
      } catch {
        // Preserve a useful provider response if it did not follow the requested JSON shape.
      }
      return {
        model,
        answer: {
          title: 'AI 營運分析', insight: outputText,
          recommendation: '請依上述分析確認後再執行營運動作。',
          evidence: '依據目前後端提供的 Incident、車損熱點與營運指標。'
        }
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  public async analyzeImages(prompt: string, images: Array<{ label: string; dataUrl: string }>): Promise<{ review: VisionReview; model: string }> {
    const { apiKey, model } = this.getCredentials();
    if (!apiKey) throw new Error('GEMINI_API_KEY_NOT_CONFIGURED');
    if (!images.length || images.length > 2) throw new Error('One or two validated images are required');

    let combinedBytes = 0;
    const imageParts = images.flatMap(image => {
      const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl);
      if (!match) throw new Error('Validated image data is not supported by Gemini');
      combinedBytes += Buffer.byteLength(match[2], 'base64');
      return [{ type: 'text', text: image.label }, { type: 'image', mime_type: match[1], data: match[2] }];
    });
    if (combinedBytes > 14 * 1024 * 1024) throw new Error('Combined images exceed Gemini inline request limit');

    const schema = {
      type: 'object', additionalProperties: false,
      properties: {
        comparisonType: { type: 'string', enum: ['new_damage', 'existing_damage', 'dirt', 'quality_issue', 'no_material_change', 'uncertain'] },
        decision: { type: 'string', enum: ['pass', 'needs_more_evidence', 'human_review'] },
        confidence: { type: 'integer', minimum: 0, maximum: 100 },
        summary: { type: 'string' },
        suspectedRegions: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label', 'description'] } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['comparisonType', 'decision', 'confidence', 'summary', 'suspectedRegions', 'evidence']
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const outputText = await this.generate(apiKey, {
        model,
        input: [{ type: 'text', text: [
          '你是 iRent 車況照片覆核助理，只描述照片中可見證據。',
          '無法確認同角度、畫質不足、差異不明或信心低於 90 時，decision 必須是 human_review 或 needs_more_evidence。',
          '不得判定責任歸屬、不得建議自動求償、不得聲稱已完成營運動作。',
          prompt
        ].join('\n') }, ...imageParts],
        response_format: { type: 'text', mime_type: 'application/json', schema }
      }, controller.signal);
      const review = JSON.parse(outputText.replace(/^```(?:json)?\s*|\s*```$/g, '')) as VisionReview;
      if (review.confidence < 90 && review.decision === 'pass') review.decision = 'human_review';
      return { review, model };
    } finally {
      clearTimeout(timeout);
    }
  }
}
