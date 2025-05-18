import { ApiProperty } from '@nestjs/swagger';

export class ReceiptItemDto {
  @ApiProperty({ description: 'Name of the item', example: 'Coffee' })
  name: string;

  @ApiProperty({ description: 'Quantity of the item', example: 1, default: 1 })
  quantity: number;

  @ApiProperty({ description: 'Price of the item', example: 3.99 })
  price: number;
}

export class CreateReceiptDto {
  @ApiProperty({ description: 'Name of the vendor', example: 'Starbucks' })
  vendorName: string;

  @ApiProperty({ description: 'Date of the transaction', example: '2023-11-15T12:30:00Z' })
  transactionDate: Date;

  @ApiProperty({ description: 'Total amount of the receipt', example: 12.99 })
  totalAmount: number;

  @ApiProperty({
    description: 'Items on the receipt',
    type: [ReceiptItemDto],
    required: false,
    isArray: true,
  })
  items?: ReceiptItemDto[];

  @ApiProperty({
    description: 'URL of the receipt image',
    required: false,
    example: '/uploads/receipt-1234567890.jpg',
  })
  imageUrl?: string;
}

export class UpdateReceiptDto {
  @ApiProperty({ description: 'Name of the vendor', example: 'Starbucks', required: false })
  vendorName?: string;

  @ApiProperty({
    description: 'Date of the transaction',
    example: '2023-11-15T12:30:00Z',
    required: false,
  })
  transactionDate?: Date;

  @ApiProperty({ description: 'Total amount of the receipt', example: 12.99, required: false })
  totalAmount?: number;

  @ApiProperty({
    description: 'Items on the receipt',
    type: [ReceiptItemDto],
    required: false,
    isArray: true,
  })
  items?: ReceiptItemDto[];
}

export class ReceiptResponseDto {
  @ApiProperty({ description: 'Unique identifier', example: '507f1f77bcf86cd799439011' })
  id: string;

  @ApiProperty({ description: 'Name of the vendor', example: 'Starbucks' })
  vendorName: string;

  @ApiProperty({ description: 'Date of the transaction', example: '2023-11-15T12:30:00Z' })
  transactionDate: Date;

  @ApiProperty({ description: 'Total amount of the receipt', example: 12.99 })
  totalAmount: number;

  @ApiProperty({
    description: 'Items on the receipt',
    type: [ReceiptItemDto],
    isArray: true,
  })
  items: ReceiptItemDto[];

  @ApiProperty({
    description: 'URL of the receipt image',
    example: '/uploads/receipt-1234567890.jpg',
  })
  imageUrl: string;

  @ApiProperty({ description: 'User ID', example: 'demo-user' })
  userId: string;

  @ApiProperty({ description: 'Creation timestamp', example: '2023-11-15T12:35:00Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp', example: '2023-11-15T12:35:00Z' })
  updatedAt: Date;
}

export class ScanReceiptResponseDto {
  @ApiProperty({ description: 'Status message', example: 'Receipt scanned and saved successfully' })
  message: string;

  @ApiProperty({ description: 'Scanned receipt data', type: ReceiptResponseDto })
  receipt: ReceiptResponseDto;
}
