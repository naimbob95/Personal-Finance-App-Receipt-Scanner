import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReceiptsService } from './receipts.service';
import { Receipt } from './schemas/receipt.schema';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiParam,
} from '@nestjs/swagger';
import {
  CreateReceiptDto,
  UpdateReceiptDto,
  ReceiptResponseDto,
  ScanReceiptResponseDto,
} from './dto/receipt.dto';

@ApiTags('receipts')
@Controller('receipts')
export class ReceiptsController {
  constructor(
    private readonly receiptsService: ReceiptsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get all receipts' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns all receipts for the user',
    type: [ReceiptResponseDto],
  })
  async findAll() {
    // For demonstration purposes, using a fixed userId
    // In a real app, you would get this from authentication
    const userId = 'demo-user';
    return this.receiptsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a receipt by ID' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the receipt with the specified ID',
    type: ReceiptResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Receipt not found',
  })
  async findOne(@Param('id') id: string) {
    const userId = 'demo-user';
    return this.receiptsService.findOne(id, userId);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new receipt' })
  @ApiBody({ type: CreateReceiptDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The receipt has been successfully created',
    type: ReceiptResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid receipt data provided',
  })
  async create(@Body() receiptData: CreateReceiptDto) {
    const userId = 'demo-user';
    return this.receiptsService.create({ ...receiptData, userId });
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a receipt' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiBody({ type: UpdateReceiptDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The receipt has been successfully updated',
    type: ReceiptResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Receipt not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid receipt data provided',
  })
  async update(@Param('id') id: string, @Body() receiptData: UpdateReceiptDto) {
    const userId = 'demo-user';
    return this.receiptsService.update(id, userId, receiptData);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a receipt' })
  @ApiParam({ name: 'id', description: 'Receipt ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'The receipt has been successfully deleted',
    type: ReceiptResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Receipt not found',
  })
  async remove(@Param('id') id: string) {
    const userId = 'demo-user';
    return this.receiptsService.remove(id, userId);
  }

  @Post('scan')
  @ApiOperation({ summary: 'Scan receipt image and extract data' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        receipt: {
          type: 'string',
          format: 'binary',
          description: 'Receipt image file (JPG, JPEG, or PNG)',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Receipt scanned and saved successfully',
    type: ScanReceiptResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid file or processing error',
  })
  @UseInterceptors(
    FileInterceptor('receipt', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = path.resolve(process.cwd(), 'uploads');

          // Ensure the directory exists
          if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
          }

          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const fileExt = path.extname(file.originalname);
          cb(null, `receipt-${uniqueSuffix}${fileExt}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Accept only image files
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException('File type not accepted. Only JPG, JPEG, and PNG are allowed.'),
            false,
          );
        }
      },
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max size
      },
    }),
  )
  async scanReceipt(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No receipt image provided');
    }

    const userId = 'demo-user';

    try {
      // Process the uploaded receipt
      const receiptData = await this.receiptsService.scanReceipt(file.path, userId);

      // Save the receipt data to database
      const savedReceipt = await this.receiptsService.create(receiptData);

      return {
        message: 'Receipt scanned and saved successfully',
        receipt: savedReceipt,
      };
    } catch (error) {
      throw new BadRequestException(`Failed to process receipt: ${error.message}`);
    }
  }

  @Get('test-config')
  @ApiOperation({ summary: 'Test API configuration' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the configuration status',
  })
  async testConfig() {
    const userId = 'demo-user';
    const apiKey = this.configService.get<string>('OPENROUTER_API_KEY');
    const hasValidKey = apiKey && apiKey !== 'your_openrouter_api_key';

    return {
      status: 'ok',
      config: {
        apiKeyConfigured: !!apiKey,
        apiKeyValid: hasValidKey,
        uploadDirectory: this.configService.get<string>('UPLOAD_DIRECTORY') || './uploads',
        model: 'anthropic/claude-3-haiku-20240307:free',
      },
      environment: process.env.NODE_ENV || 'development',
      message: hasValidKey
        ? 'Configuration looks good'
        : 'API key is not configured or still using default value',
    };
  }
}
