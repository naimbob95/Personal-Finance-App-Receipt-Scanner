import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Receipt } from './schemas/receipt.schema';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import * as JSON5 from 'json5'; // More lenient JSON parser

@Injectable()
export class ReceiptsService {
  private readonly logger = new Logger(ReceiptsService.name);

  constructor(
    @InjectModel(Receipt.name) private receiptModel: Model<Receipt>,
    private configService: ConfigService,
  ) {}

  async findAll(userId: string): Promise<Receipt[]> {
    return this.receiptModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  async findOne(id: string, userId: string): Promise<Receipt> {
    const receipt = await this.receiptModel.findOne({ _id: id, userId }).exec();
    if (!receipt) {
      throw new NotFoundException(`Receipt with ID ${id} not found`);
    }
    return receipt;
  }

  async create(receiptData: Partial<Receipt>): Promise<Receipt> {
    const newReceipt = new this.receiptModel(receiptData);
    return newReceipt.save();
  }

  async update(id: string, userId: string, receiptData: Partial<Receipt>): Promise<Receipt> {
    const updatedReceipt = await this.receiptModel
      .findOneAndUpdate({ _id: id, userId }, receiptData, { new: true })
      .exec();

    if (!updatedReceipt) {
      throw new NotFoundException(`Receipt with ID ${id} not found`);
    }

    return updatedReceipt;
  }

  async remove(id: string, userId: string): Promise<Receipt> {
    const deletedReceipt = await this.receiptModel.findOneAndDelete({ _id: id, userId }).exec();

    if (!deletedReceipt) {
      throw new NotFoundException(`Receipt with ID ${id} not found`);
    }

    return deletedReceipt;
  }

  async scanReceipt(imagePath: string, userId: string): Promise<Partial<Receipt>> {
    try {
      const exampleJson = {
        vendorName: 'name',
        transactionDate: '18/05/25',
        totalAmount: 16.05,
        items: [
          {
            name: 'Items',
            quantity: 4.29 * 0.205,
            price: 0.88,
          },
        ],
      };

      // 1. Read image file as base64
      const imageFile = fs.readFileSync(imagePath);
      const base64Image = imageFile.toString('base64');

      // 2. Call OpenRouter API
      const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
      if (!apiKey) {
        throw new BadRequestException('OpenRouter API key is not configured');
      }

      this.logger.log(
        `Sending request to OpenRouter API with image of size: ${base64Image.length}`,
      );

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'meta-llama/llama-3.2-11b-vision-instruct:free', // Using a free model
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Extract the following information from this receipt image: vendor name, transaction date, total amount, and individual items with their prices. Format the output as JSON with the keys: vendorName, transactionDate, totalAmount, items (where items is an array of objects with name, quantity, and price). IMPORTANT: Ensure your JSON is valid and follows the exact format specified.
                  this is the example json ${JSON.stringify(exampleJson)}
                  `,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/jpeg;base64,${base64Image}`,
                  },
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      // 3. Parse the response
      if (!response.data || !response.data.choices || !response.data.choices.length) {
        this.logger.error('Invalid response from OpenRouter API:', response.data);
        throw new BadRequestException('Invalid response from OpenRouter API');
      }

      const aiResponse = response.data.choices[0].message.content;
      this.logger.log(`OpenRouter AI response: ${aiResponse.substring(0, 100)}...`);

      // Full response for debugging
      console.log(aiResponse);

      // Extract and parse the JSON from the AI response
      const extractedData = this.extractJsonFromLLMResponse(aiResponse);

      // 4. Format the data for our Receipt model
      const receiptData: Partial<Receipt> = {
        vendorName: extractedData.vendorName || 'Unknown Vendor',
        transactionDate: this.parseDate(extractedData.transactionDate),
        totalAmount: parseFloat(String(extractedData.totalAmount || '0')),
        items: Array.isArray(extractedData.items) ? extractedData.items : [],
        imageUrl: imagePath.replace(/^\./, ''), // Convert to relative URL
        userId,
      };
      console.log('receiptData', receiptData);
      return receiptData;
    } catch (error) {
      this.logger.error(`Receipt scanning error: ${error.message}`);
      if (error.response) {
        this.logger.error(`OpenRouter API error: ${JSON.stringify(error.response.data)}`);
      }
      throw new BadRequestException(`Failed to scan receipt: ${error.message}`);
    }
  }

  /**
   * Extract and parse JSON from LLM response
   */
  private extractJsonFromLLMResponse(text: string): any {
    // Initialize default data
    const defaultData = {
      vendorName: 'Unknown Vendor',
      transactionDate: new Date().toISOString(),
      totalAmount: 0,
      items: [] as Array<{ name: string; quantity: number; price: number }>,
    };

    try {
      // Step 1: Try to extract JSON block using common patterns
      let jsonText = '';

      // Try to find JSON block within markdown code blocks
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonText = codeBlockMatch[1];
        this.logger.log('Found JSON in code block');
      } else {
        // Try to find JSON-like structure with curly braces
        const jsonBlockMatch = text.match(/\{[\s\S]*\}/);
        if (jsonBlockMatch) {
          jsonText = jsonBlockMatch[0];
          this.logger.log('Found JSON-like structure with curly braces');
        } else {
          // No JSON structure found
          this.logger.warn('No JSON structure found in the AI response');
          return defaultData;
        }
      }

      // Step 2: Sanitize the JSON text
      const sanitizedJson = this.sanitizeJsonString(jsonText);

      // Step 3: Try multiple parsing approaches

      // Approach 1: Try direct JSON parsing first (strictest)
      try {
        const parsedData = JSON.parse(sanitizedJson);
        this.logger.log('Successfully parsed with standard JSON.parse');
        return this.validateAndCleanData(parsedData);
      } catch (jsonError) {
        this.logger.log(`Standard JSON parsing failed: ${jsonError.message}`);
      }

      // Approach 2: Try JSON5 parsing (more lenient)
      try {
        // Remove any control characters that might be causing issues
        const cleanerJson = sanitizedJson.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
        const parsedData = JSON5.parse(cleanerJson);
        this.logger.log('Successfully parsed with JSON5.parse');
        return this.validateAndCleanData(parsedData);
      } catch (json5Error) {
        this.logger.error(`JSON5 parse error: ${json5Error.message}`);

        // Provide more context for debugging
        if (json5Error.message.includes('at')) {
          const errorParts = json5Error.message.match(/at (\d+):(\d+)/);
          if (errorParts && errorParts.length >= 3) {
            const line = parseInt(errorParts[1], 10);
            const col = parseInt(errorParts[2], 10);
            const position = this.getPositionFromLineCol(sanitizedJson, line, col);

            if (position !== -1) {
              const context = sanitizedJson.substring(
                Math.max(0, position - 20),
                Math.min(sanitizedJson.length, position + 20),
              );
              this.logger.error(`Error context: "...${context}..." (position ${position})`);
            }
          }
        }
      }

      // Approach 3: Use the regex approach as a last resort
      this.logger.log('Falling back to regex-based extraction');
      const manualData = this.extractDataWithRegex(sanitizedJson, defaultData);
      return manualData;
    } catch (error) {
      this.logger.error(`Failed to extract JSON: ${error.message}`);
      return defaultData;
    }
  }

  /**
   * Helper to validate and clean parsed data
   */
  private validateAndCleanData(data: any): any {
    // Ensure we have a valid object
    if (!data || typeof data !== 'object') {
      return {
        vendorName: 'Unknown Vendor',
        transactionDate: new Date().toISOString(),
        totalAmount: 0,
        items: [] as Array<{ name: string; quantity: number; price: number }>,
      };
    }

    // Ensure required fields exist
    const result = {
      vendorName: data.vendorName || 'Unknown Vendor',
      transactionDate: data.transactionDate || new Date().toISOString(),
      totalAmount: parseFloat(String(data.totalAmount || '0')),
      items: Array.isArray(data.items)
        ? data.items.map(item => ({
            name: item.name || 'Unnamed Item',
            quantity: parseFloat(String(item.quantity || '1')),
            price: parseFloat(String(item.price || '0')),
          }))
        : [],
    };

    return result;
  }

  /**
   * Extract data using regex patterns
   */
  private extractDataWithRegex(text: string, defaultData: any): any {
    const vendorNameMatch = text.match(/["']vendorName["']\s*:\s*["']([^"']+)["']/);
    const dateMatch = text.match(/["']transactionDate["']\s*:\s*["']([^"']+)["']/);
    const totalMatch = text.match(/["']totalAmount["']\s*:\s*([\d.]+)/);

    const manualData = {
      vendorName: vendorNameMatch ? vendorNameMatch[1] : defaultData.vendorName,
      transactionDate: dateMatch ? dateMatch[1] : defaultData.transactionDate,
      totalAmount: totalMatch ? parseFloat(totalMatch[1]) : defaultData.totalAmount,
      items: [] as Array<{ name: string; quantity: number; price: number }>,
    };

    // Try to extract items
    const itemsMatch = text.match(/["']items["']\s*:\s*\[([\s\S]*?)\]/);
    if (itemsMatch && itemsMatch[1]) {
      // Split by item objects
      const itemStrings = itemsMatch[1].split(/\}\s*,\s*\{/);

      manualData.items = itemStrings.map(itemStr => {
        // Ensure item string has surrounding braces
        if (!itemStr.trim().startsWith('{')) itemStr = '{' + itemStr;
        if (!itemStr.trim().endsWith('}')) itemStr = itemStr + '}';

        const sanitizedItemStr = this.sanitizeJsonString(itemStr);

        // Try to parse individual item
        try {
          return JSON.parse(sanitizedItemStr);
        } catch (e) {
          try {
            return JSON5.parse(sanitizedItemStr);
          } catch (e2) {
            // Extract individual fields
            const nameMatch = sanitizedItemStr.match(/["']name["']\s*:\s*["']([^"']+)["']/);
            const quantityMatch = sanitizedItemStr.match(/["']quantity["']\s*:\s*([\d.]+)/);
            const priceMatch = sanitizedItemStr.match(/["']price["']\s*:\s*([\d.]+)/);

            return {
              name: nameMatch ? nameMatch[1] : 'Unknown Item',
              quantity: quantityMatch ? parseFloat(quantityMatch[1]) : 1,
              price: priceMatch ? parseFloat(priceMatch[1]) : 0,
            };
          }
        }
      });
    }

    return manualData;
  }

  /**
   * Helper to get character position from line and column
   */
  private getPositionFromLineCol(text: string, line: number, col: number): number {
    const lines = text.split('\n');
    let position = 0;

    for (let i = 0; i < line - 1 && i < lines.length; i++) {
      position += lines[i].length + 1; // +1 for the newline character
    }

    if (line <= lines.length) {
      position += col - 1;
    }

    return position;
  }

  /**
   * Sanitize JSON string to fix common issues
   */
  private sanitizeJsonString(jsonStr: string): string {
    try {
      // 1. Log original string for debugging
      this.logger.debug(`Original JSON string length: ${jsonStr.length}`);
      if (jsonStr.length > 500) {
        this.logger.debug(`JSON start: ${jsonStr.substring(0, 100)}...`);
        this.logger.debug(`JSON end: ...${jsonStr.substring(jsonStr.length - 100)}`);
      } else {
        this.logger.debug(`JSON string: ${jsonStr}`);
      }

      // 2. Remove any leading/trailing whitespace
      let cleaned = jsonStr.trim();

      // 3. Handle escape sequences issues
      // First, temporarily replace valid escape sequences
      const escapeMap = {
        validEscapes: [] as { original: string; placeholder: string }[],
      };

      // Store valid escape sequences
      const validEscapeMatches = cleaned.match(/\\["\\/bfnrt]/g) || [];
      validEscapeMatches.forEach((match, index) => {
        const placeholder = `__ESCAPE_${index}__`;
        escapeMap.validEscapes.push({ original: match, placeholder });
        cleaned = cleaned.replace(match, placeholder);
      });

      // Remove problematic backslashes
      cleaned = cleaned.replace(/\\/g, '');

      // Restore valid escape sequences
      escapeMap.validEscapes.forEach(({ original, placeholder }) => {
        cleaned = cleaned.replace(placeholder, original);
      });

      // 4. Fix common JSON syntax issues
      cleaned = cleaned
        // Ensure all property names are double-quoted
        .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')

        // Ensure all string values are double-quoted (handling both single and no quotes)
        .replace(/:\s*'([^']*)'/g, ': "$1"')
        .replace(/:\s*([a-zA-Z][a-zA-Z0-9_\s]*[a-zA-Z0-9_])(?=\s*[,}])/g, ': "$1"')

        // Remove trailing commas in objects
        .replace(/,\s*}/g, '}')

        // Remove trailing commas in arrays
        .replace(/,\s*\]/g, ']')

        // Add missing commas between items in arrays
        .replace(/}\s*{/g, '}, {')

        // Fix missing commas between array items with other types
        .replace(/]\s*\[/g, '], [')
        .replace(/"\s*\[/g, '", [')
        .replace(/]\s*"/g, '], "')

        // Fix additional issues with nested arrays/objects
        .replace(/}\s*\[/g, '}, [')
        .replace(/]\s*{/g, '], {')

        // Fix issues with quotes and commas
        .replace(/",\s*"/g, '", "')
        .replace(/"\s*,\s*"/g, '", "')

        // Fix line breaks in strings (often a problem in LLM outputs)
        .replace(/"\s*\n\s*"/g, ' ')
        .replace(/\n/g, ' ');

      // 5. Try to ensure the result is a valid JSON object
      if (!cleaned.startsWith('{')) cleaned = '{' + cleaned;
      if (!cleaned.endsWith('}')) cleaned = cleaned + '}';

      // 6. Additional cleanup for problematic nested quotes in values
      // Replace any double-escaped quotes with single escaped quotes
      cleaned = cleaned.replace(/\\\\"/g, '\\"');
      // Remove quotes inside already quoted strings that aren't escaped
      let inString = false;
      let inEscape = false;
      let result = '';

      for (let i = 0; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (inEscape) {
          // Add the escaped character regardless
          result += char;
          inEscape = false;
          continue;
        }

        if (char === '\\') {
          result += char;
          inEscape = true;
          continue;
        }

        if (char === '"') {
          // Toggle string mode
          inString = !inString;
          result += char;
          continue;
        }

        // If we're inside a string and encounter another quote character (not escaped)
        // Replace it with a different character to avoid breaking the JSON
        if (inString && (char === '"' || char === "'")) {
          result += ' '; // Replace with space
        } else {
          result += char;
        }
      }

      cleaned = result || cleaned;

      // 7. Log the sanitized string for debugging
      this.logger.debug(`Sanitized JSON string length: ${cleaned.length}`);
      if (cleaned.length > 500) {
        this.logger.debug(`Sanitized JSON start: ${cleaned.substring(0, 100)}...`);
        this.logger.debug(`Sanitized JSON end: ...${cleaned.substring(cleaned.length - 100)}`);
      } else {
        this.logger.debug(`Sanitized JSON string: ${cleaned}`);
      }

      // Try parsing to validate (without returning)
      try {
        JSON.parse(cleaned);
        this.logger.debug('Sanitized JSON is valid standard JSON');
      } catch (e) {
        this.logger.debug(`Sanitized JSON is not valid standard JSON: ${e.message}`);
      }

      return cleaned;
    } catch (error) {
      this.logger.error(`Error during JSON sanitization: ${error.message}`);
      // Return a basic valid JSON to avoid further errors
      return '{"vendorName":"Unknown Vendor","transactionDate":"2023-01-01","totalAmount":0,"items":[]}';
    }
  }

  /**
   * Parse date from various formats
   */
  private parseDate(dateStr: string | Date | undefined): Date {
    if (!dateStr) {
      return new Date();
    }

    if (dateStr instanceof Date) {
      return dateStr;
    }

    // Try parsing with Date constructor first
    const parsedDate = new Date(dateStr);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate;
    }

    // Common date formats in receipts
    const formats = [
      // DD/MM/YY HH:MM:SS format
      {
        regex: /(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
        fn: (m: RegExpMatchArray) => {
          const year = 2000 + parseInt(m[3], 10);
          const month = parseInt(m[2], 10) - 1;
          const day = parseInt(m[1], 10);
          const hour = m[4] ? parseInt(m[4], 10) : 0;
          const minute = m[5] ? parseInt(m[5], 10) : 0;
          const second = m[6] ? parseInt(m[6], 10) : 0;
          return new Date(year, month, day, hour, minute, second);
        },
      },
      // MM/DD/YYYY format
      {
        regex: /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
        fn: (m: RegExpMatchArray) => {
          const month = parseInt(m[1], 10) - 1;
          const day = parseInt(m[2], 10);
          const year = parseInt(m[3], 10);
          return new Date(year, month, day);
        },
      },
      // DD-MM-YYYY format
      {
        regex: /(\d{1,2})-(\d{1,2})-(\d{4})/,
        fn: (m: RegExpMatchArray) => {
          const day = parseInt(m[1], 10);
          const month = parseInt(m[2], 10) - 1;
          const year = parseInt(m[3], 10);
          return new Date(year, month, day);
        },
      },
    ];

    for (const format of formats) {
      const match = dateStr.match(format.regex);
      if (match) {
        try {
          return format.fn(match);
        } catch (e) {
          this.logger.error(
            `Error parsing date ${dateStr} with format ${format.regex}: ${e.message}`,
          );
        }
      }
    }

    // If all parsing attempts fail, return current date
    this.logger.warn(`Could not parse date: ${dateStr}, using current date instead`);
    return new Date();
  }
}
