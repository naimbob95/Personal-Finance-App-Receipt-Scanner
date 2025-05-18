export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Receipt {
  id?: string;
  vendorName: string;
  transactionDate: Date;
  totalAmount: number;
  items?: ReceiptItem[];
  imageUrl?: string; // URL of the scanned receipt image
  userId: string; // To associate receipt with a user
  createdAt?: Date;
  updatedAt?: Date;
}
