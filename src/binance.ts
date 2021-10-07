import { constants } from '@mt-inc/utils';
import type { Binance, NewFuturesOrder } from 'binance-api-node';

const { OK, NOTOK } = constants;

export class BinanceTransport {
  private client: Binance;
  constructor(client: Binance) {
    this.client = client;
  }
  private returnGood<T>() {
    return (r: T) => ({ status: OK as typeof OK, data: r });
  }
  private returnBad() {
    return (e: { code: number; url: string }) => ({ status: NOTOK as typeof NOTOK, data: e });
  }
  /** Open order */
  async openOrder(order: NewFuturesOrder) {
    const request = await this.client.futuresOrder(order).then(this.returnGood()).catch(this.returnBad());
    return request;
  }
  /** Get order */
  async getOrder(options: { symbol: string; origClientOrderId: string; useServerTime?: boolean }) {
    const request = await this.client.futuresGetOrder(options).then(this.returnGood()).catch(this.returnBad());
    return request;
  }
  /** All open order */
  async allOpenOrders(options: { symbol?: string }) {
    const request = await this.client.futuresOpenOrders(options).then(this.returnGood()).catch(this.returnBad());
    return request;
  }
  /** All order */
  async allOrders(options: { symbol: string; limit?: number }) {
    const request = await this.client.futuresAllOrders(options).then(this.returnGood()).catch(this.returnBad());
    return request;
  }
  /** Cancel order */
  async cancelOrder(options: { symbol: string; origClientOrderId: string; useServerTime?: boolean }) {
    const request = await this.client.futuresCancelOrder(options).then(this.returnGood()).catch(this.returnBad());
    return request;
  }
  /** Cancel all open orders */
  async cancelAllOpenOrders(options: { symbol: string }) {
    const request = await this.client
      .futuresCancelAllOpenOrders(options)
      .then(this.returnGood())
      .catch(this.returnBad());
    return request;
  }
}
