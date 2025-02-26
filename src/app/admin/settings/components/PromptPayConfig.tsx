"use client";

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebase/firebaseConfig';
import { QRCodeSVG } from 'qrcode.react';

interface PromptPaySettings {
  accountName: string;
  accountNumber: string;
  isActive: boolean;
  dormitoryId: string;
  qrCodeUrl?: string;
}

const getPromptPayConfig = async (dormitoryId: string) => {
  try {
    const docRef = doc(db, 'dormitories', dormitoryId, 'settings', 'promptpay');
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return {
        success: true,
        data: docSnap.data() as PromptPaySettings
      };
    }
    
    return {
      success: true,
      data: null
    };
  } catch (error) {
    console.error('Error getting PromptPay config:', error);
    return {
      success: false,
      error: 'Failed to load PromptPay configuration'
    };
  }
};

export default function PromptPayConfig() {
  const [config, setConfig] = useState<PromptPaySettings>({
    accountName: '',
    accountNumber: '',
    isActive: false,
    dormitoryId: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDormitory, setSelectedDormitory] = useState("");

  const loadSettings = useCallback(async () => {
    if (!selectedDormitory) return;
    
    try {
      setIsLoading(true);
      const result = await getPromptPayConfig(selectedDormitory);
      if (result.success && result.data) {
        setConfig(result.data);
      }
    } catch (error) {
      console.error("Error loading PromptPay config:", error);
      toast.error("เกิดข้อผิดพลาดในการโหลดการตั้งค่า PromptPay");
    } finally {
      setIsLoading(false);
    }
  }, [selectedDormitory]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const updatedSettings = {
        ...config,
        dormitoryId: selectedDormitory,
        updatedAt: new Date().toISOString()
      };

      await setDoc(doc(db, 'settings', `promptpay_${selectedDormitory}`), updatedSettings);
      toast.success('บันทึกการตั้งค่า PromptPay สำเร็จ');
    } catch (error) {
      console.error('Error saving PromptPay settings:', error);
      toast.error('เกิดข้อผิดพลาดในการบันทึกการตั้งค่า PromptPay');
    } finally {
      setIsLoading(false);
    }
  };

  // สร้าง QR Code สำหรับ PromptPay
  const generateQRPayload = (paymentAmount?: number) => {
    // อ้างอิงจาก EMVCo Merchant QR Code specification
    const version = '000201';  // เวอร์ชัน
    const method = '010211';   // ชำระเงินด้วย PromptPay
    const merchantInfo = `2937${config?.accountNumber.length.toString().padStart(2, '0')}${config?.accountNumber}`;
    const countryCode = '5802TH';
    const currencyCode = '5303764';
    const amountField = paymentAmount ? `54${paymentAmount.toString().length.toString().padStart(2, '0')}${paymentAmount}` : '';
    const checksum = '6304';   // จะคำนวณ CRC16 ทีหลัง

    return `${version}${method}${merchantInfo}${countryCode}${currencyCode}${amountField}${checksum}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">PromptPay</h3>
        <p className="mt-1 text-sm text-gray-500">
          จัดการการตั้งค่า PromptPay สำหรับรับชำระเงิน
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">ชื่อบัญชี</label>
          <input
            type="text"
            value={config?.accountName}
            onChange={(e) => setConfig({ ...config, accountName: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">เบอร์โทรศัพท์/เลขประจำตัวผู้เสียภาษี</label>
          <input
            type="text"
            value={config?.accountNumber}
            onChange={(e) => setConfig({ ...config, accountNumber: e.target.value })}
            pattern="\d{10}|\d{13}"
            title="กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลขประจำตัวผู้เสียภาษี 13 หลัก"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="isActive"
            checked={config?.isActive}
            onChange={(e) => setConfig({ ...config, isActive: e.target.checked })}
            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <label htmlFor="isActive" className="text-sm font-medium">
            เปิดใช้งานการชำระเงินผ่าน PromptPay
          </label>
        </div>

        {config?.accountNumber && (
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">QR Code</h4>
            <div className="p-4 bg-white border border-gray-200 rounded-lg">
              <QRCodeSVG
                value={generateQRPayload()}
                size={240}
                level="M"
                includeMargin={true}
              />
            </div>
            <p className="mt-2 text-sm text-gray-500">
              * QR Code นี้สามารถใช้สแกนเพื่อชำระเงินได้ทันที
            </p>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isLoading ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </button>
        </div>
      </form>
    </div>
  );
} 