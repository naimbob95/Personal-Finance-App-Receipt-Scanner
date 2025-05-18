import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class ReceiptItem {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, default: 1 })
  quantity: number;

  @Prop({ required: true })
  price: number;
}

@Schema({ timestamps: true })
export class Receipt extends Document {
  @Prop({ required: true })
  vendorName: string;

  @Prop({ required: true })
  transactionDate: Date;

  @Prop({ required: true })
  totalAmount: number;

  @Prop({ type: [ReceiptItem], default: [] })
  items: ReceiptItem[];

  @Prop()
  imageUrl: string;

  @Prop({ required: true })
  userId: string;
}

export const ReceiptSchema = SchemaFactory.createForClass(Receipt);
