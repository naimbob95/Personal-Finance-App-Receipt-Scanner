import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReceiptsController } from './receipts.controller';
import { ReceiptsService } from './receipts.service';
import { Receipt, ReceiptSchema } from './schemas/receipt.schema';

@Module({
  imports: [MongooseModule.forFeature([{ name: Receipt.name, schema: ReceiptSchema }])],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
})
export class ReceiptsModule {}
