import crypto from 'crypto';
import { Ticket, TicketMessage } from '../src/types';
import { storage } from './storage';

const TICKETS_FILE = 'telegram_tickets.json';

class TicketStore {
  private tickets: Ticket[] = [];

  constructor() {
    this.loadFromStorage();
  }

  public loadFromStorage(): void {
    try {
      if (storage.existsSync(TICKETS_FILE)) {
        const data = storage.readFileSync(TICKETS_FILE);
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.tickets = parsed;
        }
      }
    } catch (err) {
      console.error('[TicketStore] Error loading tickets:', err);
    }
  }

  public saveToStorage(): void {
    try {
      storage.writeFileSync(TICKETS_FILE, JSON.stringify(this.tickets, null, 2));
    } catch (err) {
      console.error('[TicketStore] Error saving tickets:', err);
    }
  }

  public getAllTickets(): Ticket[] {
    return [...this.tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public getTicketById(id: string): Ticket | undefined {
    return this.tickets.find((t) => t.id === id);
  }

  public getOpenTicketByChatId(chatId: number): Ticket | undefined {
    return this.tickets.find((t) => t.chatId === chatId && t.status === 'open');
  }

  public addMessage(params: {
    chatId: number;
    userName: string;
    phone: string;
    sender: 'user' | 'admin';
    text?: string;
    photoUrl?: string;
    voiceUrl?: string;
  }): Ticket {
    const { chatId, userName, phone, sender, text, photoUrl, voiceUrl } = params;
    
    // Find open ticket or create a new one
    let ticket = this.getOpenTicketByChatId(chatId);
    if (!ticket) {
      ticket = {
        id: `t_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        chatId,
        userName: userName || 'کاربر تلگرام',
        phone: phone || 'بدون شماره',
        subject: 'پشتیبانی ربات',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: []
      };
      this.tickets.push(ticket);
    }

    const newMessage: TicketMessage = {
      id: `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      sender,
      text,
      photoUrl,
      voiceUrl,
      createdAt: new Date().toISOString()
    };

    ticket.messages.push(newMessage);
    ticket.updatedAt = new Date().toISOString();
    ticket.isRead = sender === 'admin';
    if (sender === 'user') {
      ticket.status = 'open';
    }
    
    this.saveToStorage();
    return ticket;
  }

  public getUnreadCount(): number {
    return this.tickets.filter((t) => !t.isRead).length;
  }

  public markTicketAsRead(id: string): boolean {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.isRead = true;
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public closeTicket(id: string): boolean {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.status = 'closed';
      ticket.updatedAt = new Date().toISOString();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public openTicket(id: string): boolean {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.status = 'open';
      ticket.updatedAt = new Date().toISOString();
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public deleteTicket(id: string): boolean {
    const initialLen = this.tickets.length;
    this.tickets = this.tickets.filter((t) => t.id !== id);
    if (this.tickets.length !== initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public deleteTicketsByChatId(chatId: number): void {
    this.tickets = this.tickets.filter((t) => t.chatId !== chatId);
    this.saveToStorage();
  }
}

export const ticketStore = new TicketStore();
