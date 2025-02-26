"use client";

import { useState, useEffect } from "react";
import { Room, RoomType, DormitoryConfig } from "@/types/dormitory";
import { addRoom, getInitialMeterReading, getRooms, getDormitory } from "@/lib/firebase/firebaseUtils";
import { toast } from "sonner";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/firebaseConfig";
import Modal from "@/components/ui/modal";

interface AddRoomModalProps {
  dormitoryId: string;
  roomTypes: RoomType[];
  onClose: () => void;
  onSuccess: (room: Room) => void;
  isOpen: boolean;
  totalFloors: number;
}

// เพิ่มฟังก์ชั่นสำหรับแปลง range string เป็น array ของเลขห้อง
const parseRoomNumberRanges = (rangeString: string): string[] => {
  const roomNumbers: string[] = [];
  
  // แยก range ด้วยเครื่องหมาย ,
  const ranges = rangeString.split(',').map(r => r.trim());
  
  ranges.forEach(range => {
    // ตรวจสอบว่าเป็น range หรือเลขห้องเดี่ยว
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(n => parseInt(n));
      // ตรวจสอบว่า start และ end เป็นตัวเลขที่ถูกต้อง
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        // สร้างเลขห้องในช่วง start ถึง end
        for (let i = start; i <= end; i++) {
          roomNumbers.push(i.toString().padStart(3, '0'));
        }
      }
    } else {
      // กรณีเป็นเลขห้องเดี่ยว
      const num = parseInt(range);
      if (!isNaN(num)) {
        roomNumbers.push(num.toString().padStart(3, '0'));
      }
    }
  });
  
  return roomNumbers;
};

// แก้ไข interface FormData เพื่อรองรับ batch creation
interface FormData {
  numbers: string; // เปลี่ยนจาก number เป็น numbers สำหรับรับ range string
  floor: number;
  roomType: string;
  status: Room['status'];
  initialMeterReading: string;
  additionalServices: string[]; // เพิ่มฟิลด์ใหม่
}

export default function AddRoomModal({
  isOpen,
  onClose,
  dormitoryId,
  onSuccess,
  roomTypes: initialRoomTypes,
  totalFloors,
}: AddRoomModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [roomTypes, setRoomTypes] = useState<RoomType[]>(initialRoomTypes);
  const [dormitoryConfig, setDormitoryConfig] = useState<DormitoryConfig | null>(null);
  const [existingRooms, setExistingRooms] = useState<Room[]>([]);
  
  // ย้าย useState ของ formData มาไว้ด้านบน
  const defaultRoomType = Array.isArray(roomTypes) ? (roomTypes.find(type => type.isDefault) || roomTypes[0]) : null;
  const [formData, setFormData] = useState<FormData>({
    numbers: "",
    floor: 1,
    roomType: defaultRoomType?.id || "",
    status: "available",
    initialMeterReading: "0",
    additionalServices: [], // เพิ่มค่าเริ่มต้น
  });
  
  // เพิ่ม useEffect เพื่อดึงข้อมูล dormitory config
  useEffect(() => {
    const fetchDormitoryConfig = async () => {
      const result = await getDormitory(dormitoryId);
      if (result.success && result.data?.config) {
        setDormitoryConfig(result.data.config);
      }
    };
    fetchDormitoryConfig();
  }, [dormitoryId]);
  
  // ถ้าไม่มีรูปแบบห้องให้แจ้งเตือน
  useEffect(() => {
    if (!Array.isArray(roomTypes) || roomTypes.length === 0) {
      toast.error("กรุณาเพิ่มรูปแบบห้องพักก่อน");
      onClose();
      return;
    }
  }, [roomTypes, onClose]);
  
  // อัพเดท roomType เมื่อ defaultRoomType เปลี่ยน
  useEffect(() => {
    if (defaultRoomType) {
      setFormData(prev => ({
        ...prev,
        roomType: defaultRoomType.id
      }));
    }
  }, [defaultRoomType]);
  
  // เพิ่ม useEffect เพื่อดึงค่ามิเตอร์เริ่มต้น
  useEffect(() => {
    const fetchInitialMeterReading = async () => {
      const reading = await getInitialMeterReading(dormitoryId);
      setFormData(prev => ({
        ...prev,
        initialMeterReading: reading.toString()
      }));
    };

    if (isOpen) {
      fetchInitialMeterReading();
    }
  }, [dormitoryId, isOpen]);
  
  // โหลดข้อมูลห้องที่มีอยู่แล้ว
  useEffect(() => {
    const loadExistingRooms = async () => {
      try {
        const result = await getRooms(dormitoryId);
        if (result.success && result.data) {
          setExistingRooms(result.data);
        }
      } catch (error) {
        console.error('Error loading existing rooms:', error);
      }
    };

    loadExistingRooms();
  }, [dormitoryId]);
  
  if (!defaultRoomType) {
    return null;
  }

  // ตรวจสอบว่าเลขห้องซ้ำหรือไม่
  const isRoomNumberTaken = (number: string) => {
    return existingRooms.some(room => 
      room.number === number && room.status === 'occupied'
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.numbers.trim() || !formData.roomType) {
      toast.error("กรุณากรอกข้อมูลให้ครบถ้วน");
      return;
    }

    try {
      setIsSubmitting(true);
      const roomNumbers = parseRoomNumberRanges(formData.numbers);
      
      if (roomNumbers.length === 0) {
        toast.error("กรุณาระบุเลขห้องให้ถูกต้อง");
        setIsSubmitting(false);
        return;
      }

      // ตรวจสอบว่ามีเลขห้องซ้ำกันในการสร้างครั้งนี้หรือไม่
      const uniqueNumbers = new Set(roomNumbers);
      if (uniqueNumbers.size !== roomNumbers.length) {
        toast.error("มีเลขห้องที่ซ้ำกันในรายการที่จะสร้าง กรุณาตรวจสอบอีกครั้ง");
        setIsSubmitting(false);
        return;
      }

      // ตรวจสอบเลขห้องซ้ำ
      if (isRoomNumberTaken(roomNumbers[0])) {
        toast.error('เลขห้องนี้มีผู้เช่าอยู่แล้ว');
        setIsSubmitting(false);
        return;
      }

      // สร้างห้องพักทีละห้อง
      let completedRooms = 0;
      const results = [];
      
      for (const number of roomNumbers) {
        // ใช้ doc().id แทน crypto.randomUUID()
        const roomRef = doc(collection(db, 'dormitories', dormitoryId, 'rooms'));
        const roomId = roomRef.id;
        
        const roomData: Room = {
          id: roomId, // ใช้ ID ที่ได้จาก Firestore
          dormitoryId,
          number,
          floor: formData.floor,
          roomType: formData.roomType,
          status: formData.status,
          initialMeterReading: parseFloat(formData.initialMeterReading) || 0,
          additionalServices: formData.additionalServices,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = await addRoom(dormitoryId, roomData);
        results.push(result);
        completedRooms++;
        setProgress({ current: completedRooms, total: roomNumbers.length });
      }

      // ตรวจสอบผลลัพธ์
      const failedRooms = results.filter(result => !result.success);
      if (failedRooms.length > 0) {
        toast.error(`ไม่สามารถสร้างห้องพักได้ ${failedRooms.length} ห้อง`);
      } else {
        toast.success(`สร้างห้องพักสำเร็จ ${results.length} ห้อง`);
        const firstRoom = results[0];
        if (firstRoom.success && firstRoom.data) {
          onSuccess(firstRoom.data);
        }
        onClose();
      }
    } catch (error) {
      console.error("Error adding rooms:", error);
      toast.error("เกิดข้อผิดพลาดในการเพิ่มห้องพัก");
    } finally {
      setIsSubmitting(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  // เพิ่มฟังก์ชันสำหรับจัดการการเลือกค่าบริการเพิ่มเติม
  const handleAdditionalServiceChange = (serviceId: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      additionalServices: checked 
        ? [...prev.additionalServices, serviceId]
        : prev.additionalServices.filter(id => id !== serviceId)
    }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full">
        <h2 className="text-lg font-medium text-gray-900 mb-4">เพิ่มห้องพัก</h2>
        {isSubmitting && progress.total > 0 && (
          <div className="mb-4">
            <div className="text-center mb-2 text-xl font-semibold">
              กำลังเพิ่มห้องพัก {progress.current} จาก {progress.total} ห้อง
            </div>
            <div className="w-full bg-gray-200 rounded-full h-4">
              <div 
                className="bg-blue-600 h-4 rounded-full transition-all duration-300"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              เลขห้อง <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="numbers"
              value={formData.numbers}
              onChange={(e) => {
                const value = e.target.value;
                if (isRoomNumberTaken(value)) {
                  toast.error('เลขห้องนี้มีผู้เช่าอยู่แล้ว');
                  return;
                }
                setFormData({ ...formData, numbers: value });
              }}
              className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm px-4 py-2.5"
              placeholder="เช่น 101-105, 201, 203"
            />
            <p className="mt-1 text-sm text-gray-500">
              สามารถระบุเป็นช่วงได้ เช่น 101-105 หรือระบุทีละห้องได้ เช่น 201, 203
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ชั้น <span className="text-red-500">*</span>
            </label>
            <select
              name="floor"
              value={formData.floor}
              onChange={(e) =>
                setFormData({ ...formData, floor: parseInt(e.target.value) })
              }
              className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm px-4 py-2.5 bg-white hover:bg-gray-50 transition-colors"
            >
              <option value="">เลือกชั้น</option>
              {Array.from({ length: totalFloors }, (_, i) => i + 1).map((floor) => (
                <option key={floor} value={floor}>
                  ชั้น {floor}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              รูปแบบห้อง <span className="text-red-500">*</span>
            </label>
            <select
              name="roomType"
              value={formData.roomType}
              onChange={(e) =>
                setFormData({ ...formData, roomType: e.target.value })
              }
              className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm px-4 py-2.5 bg-white hover:bg-gray-50 transition-colors"
            >
              <option value="">เลือกประเภทห้อง</option>
              {roomTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}: {type.basePrice?.toLocaleString() ?? 0} บาท/เดือน
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ค่ามิเตอร์เริ่มต้น
            </label>
            <input
              type="number"
              name="initialMeterReading"
              value={formData.initialMeterReading}
              onChange={(e) =>
                setFormData({ ...formData, initialMeterReading: e.target.value })
              }
              min="0"
              className="block w-full rounded-md border border-gray-300 shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 sm:text-sm px-4 py-2.5 bg-white hover:bg-gray-50 transition-colors"
              placeholder="ค่ามิเตอร์เริ่มต้น"
            />
          </div>

          {/* เพิ่มส่วนของค่าบริการเพิ่มเติม */}
          <div className="space-y-4 mt-4">
            <h3 className="text-sm font-medium text-gray-900">ค่าบริการเพิ่มเติม</h3>
            <div className="space-y-2">
              {dormitoryConfig?.additionalFees?.items?.map((item) => (
                <label key={item.id} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={formData.additionalServices.includes(item.id)}
                    onChange={(e) => handleAdditionalServiceChange(item.id, e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-600">
                    {item.name} ({item.amount.toLocaleString()} บาท)
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? "กำลังบันทึก..." : "บันทึก"}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
} 