import { constants } from '@mt-inc/utils';
import { Time } from '@mt-inc/utils';
import { Math as MathHelper } from '@mt-inc/utils';
import { ErrorCodes } from 'binance-api-node';
import { DB } from '@mt-inc/utils';
import { BinanceTransport } from './binance';
import type { Pairs } from '@mt-inc/utils/dist/esm/src/const';
import type { Binance, NewFuturesOrder, QueryFuturesOrderResult, OrderType_LT } from 'binance-api-node';

const SELL = constants.SELL;
const BUY = constants.BUY;

declare module 'binance-api-node' {
  interface Binance {
    futuresOrder(options: NewFuturesOrder): Promise<QueryFuturesOrderResult>;
    futuresCancelOrder(options: {
      symbol: string;
      orderId: number;
      useServerTime?: boolean;
    }): Promise<CancelOrderResult>;
    futuresCancelOrder(options: {
      symbol: string;
      origClientOrderId: string;
      useServerTime?: boolean;
    }): Promise<CancelOrderResult>;
    futuresAllOrders(options: { symbol: string }): Promise<QueryFuturesOrderResult[]>;
    futuresCancelAllOpenOrders(options: { symbol: string }): Promise<{ code: number; msg: string }>;
  }
}

export type PositionType = {
  price: number;
  type: typeof SELL | typeof BUY;
  open: boolean;
  amount: number;
  sl: number;
  leverage: number;
  time: number;
  closePrice?: number;
  closeTime?: number;
  net?: number;
  tp?: number;
  tsl?: number;
  tslTrig?: number;
  cost: number;
  name?: string;
  humanTime?: string;
  humanCloseTime?: string;
  id: string;
  binance?: QueryFuturesOrderResult;
  closeBinance?: QueryFuturesOrderResult;
  openType?: OrderType_LT;
  closeType?: OrderType_LT;
  partiallyFilled?: boolean;
  origQty: number;
};

type PositionsResult = {
  all: number;
  profit: {
    amount: number;
    buy: number;
    sell: number;
    buyAmount: number;
    sellAmount: number;
  };
  loss: {
    amount: number;
    buy: number;
    sell: number;
    buyAmount: number;
    sellAmount: number;
  };
  notOpened: number;
  net: number;
};

export class Positions {
  protected ap: boolean;
  private position?: PositionType;
  private result: PositionsResult;
  private historyResult?: PositionsResult;
  private openFee: number;
  private closeFee: number;
  private defFee: number;
  private bigDefFee: number;
  private start: number;
  private wallet: number;
  private limit: number;
  private leverage: number;
  private timeout: number;
  private db?: DB<PositionType[]>;
  private timeAgo: Time;
  private now: number;
  private math: MathHelper;
  private precision: { [x in Pairs]: number };
  private pricePrecision: { [x in Pairs]: number };
  private pair: Pairs;
  private name: string;
  private client?: Binance;
  private useBinance?: boolean;
  private doNotDisturb: boolean;
  private timer: {
    open: NodeJS.Timer | null;
    close: NodeJS.Timer | null;
  };
  private pending: boolean;
  private tpsl?: { tpP: number; slP: number };
  private cbOpen?: () => void;
  private cbClose?: (net: number) => void;
  private cbError?: (e: any) => void;
  private closing: boolean;
  private tsl?: {
    tSlP: number;
  };
  private lastPrice: number;
  private bestPrice: number;
  private sent: boolean;
  private rcvWindow: number;
  private bt?: BinanceTransport;
  private test: boolean;
  private fallMax: number;
  private fallMin: number;
  private fallPerc: number;
  constructor(
    wallet = 0,
    limit = 0,
    leverage = 1,
    filename: string | null = null,
    pair: Pairs = 'BTCUSDT',
    name?: string,
    useBinance = false,
    client?: Binance,
    cbOpen?: () => void,
    cbClose?: (net: number) => void,
    cbError?: (e: any) => void,
    tpsl?: { tpP: number; slP: number },
    tsl?: { tSlP: number },
    test = false,
  ) {
    this.name = name || `test-${new Date().getTime()}`;
    this.ap = false;
    this.result = {
      all: 0,
      profit: {
        amount: 0,
        buy: 0,
        sell: 0,
        buyAmount: 0,
        sellAmount: 0,
      },
      loss: {
        amount: 0,
        buy: 0,
        sell: 0,
        buyAmount: 0,
        sellAmount: 0,
      },
      notOpened: 0,
      net: 0,
    };
    this.openFee = 0.0002;
    this.closeFee = 0.0002;
    this.defFee = 0.0002;
    this.bigDefFee = 0.0004;
    this.start = new Date().getTime();
    this.wallet = wallet;
    this.leverage = 1;
    if (leverage >= 1) {
      this.leverage = leverage;
    }
    this.timeout = 5000;
    if (filename) {
      this.db = new DB(filename);
    }
    this.timeAgo = new Time();
    this.now = 0;
    this.limit = limit;
    this.math = new MathHelper();
    this.pair = pair;
    this.precision = {
      BTCUSDT: 3,
      BNBUSDT: 2,
      ETHUSDT: 3,
      ADAUSDT: 0,
      DOGEUSDT: 0,
      DOTUSDT: 1,
      BTCBUSD: 3,
      BNBBUSD: 2,
      ETHBUSD: 3,
      DOGEBUSD: 0,
      SOLUSDT: 0,
      XRPUSDT: 1,
    };
    this.pricePrecision = {
      BTCUSDT: 2,
      BNBUSDT: 2,
      ETHUSDT: 2,
      ADAUSDT: 4,
      DOGEUSDT: 5,
      DOTUSDT: 3,
      BTCBUSD: 2,
      BNBBUSD: 2,
      ETHBUSD: 2,
      DOGEBUSD: 5,
      SOLUSDT: 3,
      XRPUSDT: 4,
    };
    this.useBinance = useBinance;
    this.client = client;
    this.doNotDisturb = false;
    this.timer = {
      open: null,
      close: null,
    };
    this.pending = false;
    this.cbOpen = cbOpen;
    this.cbClose = cbClose;
    this.cbError = cbError;
    this.fallMax = wallet;
    this.fallMin = 0;
    this.fallPerc = 0;
    if (tpsl) {
      this.tpsl = {
        slP: (tpsl.slP >= 98.5 ? 98.5 : tpsl.slP) / 100 / leverage,
        tpP: tpsl.tpP / 100 / leverage,
      };
    }
    if (tsl && tsl.tSlP > 0) {
      this.tsl = {
        tSlP: (tsl.tSlP >= 98.5 ? 98.5 : tsl.tSlP) / 100 / leverage,
      };
    }
    this.lastPrice = 0;
    this.bestPrice = 0;
    this.closing = false;
    this.sent = false;
    this.rcvWindow = 10000;
    if (this.client && this.useBinance) {
      this.bt = new BinanceTransport(this.client);
    }
    this.test = test;
    if (!this.test) {
      this.checkOpenPositions();
      this.loadHistoryResult();
    }
  }
  /** Handle Error */
  private handleError(e: any) {
    if (!this.test) {
      if (this.cbError) {
        this.cbError(e);
      }
      console.log(new Date(), ' ', this.name);
      console.log(e);
    }
  }
  /** Check open positions */
  private checkOpenPositions() {
    if (this.db) {
      const tmp = this.db.read();
      if (tmp) {
        const current = tmp
          .filter((item) => item.name === this.name)
          .sort((a, b) => b.time - a.time)
          .slice(0, 1);

        if (current.length === 1 && !current[0].closePrice && current[0].open) {
          this.position = current[0];
          this.ap = true;
          this.result.all++;
          this.wallet = this.position.cost;
        }
      }
    }
  }
  /** Check open positions */
  private loadHistoryResult() {
    if (this.db) {
      const tmp = this.db.read();
      if (tmp) {
        const history = tmp.filter((item) => item.name === this.name);
        if (history.length > 0) {
          const prof = history.filter((item) => item.net && item.net > 0);
          const profBuy = prof.filter((item) => item.type === 'BUY');
          const profSell = prof.filter((item) => item.type === 'SELL');
          const loss = history.filter((item) => item.net && item.net <= 0);
          const lossBuy = loss.filter((item) => item.type === 'BUY');
          const lossSell = loss.filter((item) => item.type === 'SELL');
          const profAmount = this.math.round(prof.reduce((res, item) => (res += item.net || 0), 0));
          const lossAmount = -this.math.round(loss.reduce((res, item) => (res += item.net || 0), 0));
          this.historyResult = {
            all: history.length,
            profit: {
              amount: profAmount,
              buy: profBuy.length,
              sell: profSell.length,
              buyAmount: this.math.round(profBuy.reduce((res, item) => (res += item.net || 0), 0)),
              sellAmount: this.math.round(profSell.reduce((res, item) => (res += item.net || 0), 0)),
            },
            loss: {
              amount: lossAmount,
              buy: lossBuy.length,
              sell: lossSell.length,
              buyAmount: this.math.round(lossBuy.reduce((res, item) => (res += item.net || 0), 0)),
              sellAmount: this.math.round(lossSell.reduce((res, item) => (res += item.net || 0), 0)),
            },
            notOpened: history.filter((item) => !item.open).length,
            net: this.math.round(profAmount - lossAmount),
          };
        }
      }
    }
  }
  /** Open position */
  async openPosition(pr: number, type: typeof SELL | typeof BUY, time?: number) {
    if (!this.ap) {
      if (this.timer.close) {
        setTimeout(() => this.openPosition(pr, type), 1000);
        return;
      }
      let price = pr;
      this.openFee = this.defFee;
      this.closeFee = this.defFee;
      const usable = this.limit === 0 ? this.wallet : this.wallet > this.limit ? this.limit : this.wallet;
      const am = this.math.round((usable / price) * this.leverage, this.precision[this.pair], true);
      if (am > 0) {
        const id = this.getId();
        const cost = this.math.round((price * am) / this.leverage);
        const tempPos: PositionType = {
          name: this.name,
          price,
          type,
          open: false,
          amount: am,
          leverage: this.leverage,
          id,
          sl: this.countSL(type, price, am, (price * am) / this.leverage),
          time: time || new Date().getTime(),
          cost,
          openType: 'LIMIT',
          origQty: am,
        };
        if (this.tpsl && !this.tsl) {
          tempPos.tp = this.countTP(type, price, am);
        }
        if (this.tsl) {
          tempPos.tslTrig = this.countTP(type, price, am, true);
        }
        this.position = { ...tempPos };
        if (this.client && this.useBinance && !this.doNotDisturb && !this.pending) {
          await this.binanceOpenPosition();
        } else if (!this.useBinance) {
          this.ap = true;
          if (time) {
            this.position.open = true;
          }
          if (this.cbOpen) {
            this.cbOpen();
          }
        }
        this.write();
      } else {
        this.handleError(new Error('Недостатньо грошей для відкриття позиції'));
      }
    }
  }
  /** Binance open position */
  async binanceOpenPosition(i = 0, market = false) {
    const openPos = (res: QueryFuturesOrderResult) => {
      if (this.position) {
        this.position.partiallyFilled = res.status === 'PARTIALLY_FILLED';
        if (parseFloat(res.executedQty) <= this.position.origQty) {
          this.position.amount = parseFloat(res.executedQty);
          this.position.cost = this.math.round((this.position.amount * this.position.price) / this.leverage);
        }
        if (parseFloat(res.avgPrice) !== this.position.price) {
          this.openFee = this.bigDefFee;
          this.position.openType = 'MARKET';
          this.position.price = parseFloat(res.avgPrice);
          this.position.sl = this.countSL(
            this.position.type,
            this.position.price,
            this.position.amount,
            (this.position.amount * this.position.price) / this.leverage,
          );
          if (this.tpsl && !this.tsl) {
            this.position.tp = this.countTP(this.position.type, this.position.price, this.position.amount);
          }
          if (this.tsl) {
            this.position.tslTrig = this.countTP(this.position.type, this.position.price, this.position.amount, true);
          }
          this.position.cost = this.math.round((this.position.price * this.position.amount) / this.leverage);
        }
        this.position.binance = res;
        this.position.time = res.updateTime;
        if (!this.sent) {
          this.position.open = true;
          this.result.all++;
          this.ap = true;
          if (this.cbOpen) {
            this.cbOpen();
          }
          this.sent = true;
        }
        this.write();
      }
    };
    if (this.client && this.position && this.bt) {
      if ((!this.doNotDisturb || i > 0) && !this.pending) {
        const pos = { ...this.position };
        this.doNotDisturb = true;
        this.pending = true;
        let order: NewFuturesOrder = {
          newClientOrderId: pos.id,
          quantity: `${pos.amount}`,
          side: pos.type,
          symbol: this.pair,
          type: 'LIMIT',
          newOrderRespType: 'FULL',
          timeInForce: 'GTC',
          price: this.math.round(pos.price, this.pricePrecision[this.pair]),
          recvWindow: this.rcvWindow,
        };
        if (market) {
          order = {
            newClientOrderId: pos.id,
            quantity: `${pos.amount}`,
            side: pos.type,
            symbol: this.pair,
            type: 'MARKET',
            newOrderRespType: 'FULL',
            recvWindow: this.rcvWindow,
          };
        }
        const openPositionRequest = await this.bt.openOrder(order);
        this.pending = false;
        if (openPositionRequest.status === 'OK') {
          const openPositionRequestData = openPositionRequest.data;
          this.position.binance = openPositionRequestData;
          if (openPositionRequestData.status === 'FILLED') {
            openPos(openPositionRequestData);
            this.doNotDisturb = false;
          } else {
            if (openPositionRequestData.status === 'PARTIALLY_FILLED') {
              openPos(openPositionRequestData);
            }
            this.timer.open = setInterval(async () => {
              if (this.client && this.position && this.useBinance && !this.pending && this.bt) {
                if (!this.position.open || this.position.partiallyFilled) {
                  this.pending = true;
                  const getOrderRequest = await this.bt.getOrder({
                    symbol: this.pair,
                    origClientOrderId: this.position.id,
                  });
                  this.pending = false;
                  if (getOrderRequest.status === 'OK') {
                    const getOrderRequestData = getOrderRequest.data;
                    if (getOrderRequestData.status === 'FILLED') {
                      if (this.timer.open) {
                        clearInterval(this.timer.open);
                        this.timer.open = null;
                      }
                      openPos(getOrderRequestData);
                      this.doNotDisturb = false;
                    } else if (getOrderRequestData.status === 'PARTIALLY_FILLED') {
                      openPos(getOrderRequestData);
                    } else {
                      const time = new Date().getTime();
                      if (time - this.position.time >= this.timeout) {
                        this.pending = true;
                        const cancelRequest = await this.bt.cancelOrder({
                          origClientOrderId: this.position.id,
                          symbol: this.pair,
                        });
                        this.pending = false;
                        if (cancelRequest.status === 'NOTOK') {
                          if (cancelRequest.data.code === -2011) {
                            this.pending = true;
                            const cancelAllRequest = await this.bt.cancelAllOpenOrders({ symbol: this.pair });
                            this.pending = false;
                            if (cancelAllRequest.status === 'NOTOK') {
                              this.handleError(cancelAllRequest.data);
                            }
                            if (this.timer.open) {
                              clearInterval(this.timer.open);
                              this.timer.open = null;
                            }
                            this.result.notOpened++;
                            this.doNotDisturb = false;
                            return;
                          }
                          if (cancelRequest.data.code !== -2011) {
                            if (this.timer.open) {
                              clearInterval(this.timer.open);
                              this.timer.open = null;
                            }
                            this.doNotDisturb = false;
                            this.handleError(cancelRequest.data);
                          }
                          return;
                        }
                        if (this.timer.open) {
                          clearInterval(this.timer.open);
                          this.timer.open = null;
                        }
                        this.doNotDisturb = false;
                        this.binanceOpenPosition(i, true);
                      }
                    }
                  } else if (getOrderRequest.status === 'NOTOK') {
                    const e = getOrderRequest.data;
                    if (e.code !== -2011 && e.code !== -1021) {
                      this.pending = true;
                      const errorCancelAllOrdersRequest = await this.bt.cancelAllOpenOrders({ symbol: this.pair });
                      this.pending = false;
                      if (errorCancelAllOrdersRequest.status === 'NOTOK') {
                        this.handleError(errorCancelAllOrdersRequest.data);
                        return;
                      }
                      if (this.timer.open) {
                        clearInterval(this.timer.open);
                        this.timer.open = null;
                      }
                      this.doNotDisturb = false;
                      return this.handleError(e);
                    }
                  }
                }
              }
            }, 1000);
          }
        } else if (openPositionRequest.status === 'NOTOK') {
          const e = openPositionRequest.data;
          if (e.code === ErrorCodes.INVALID_TIMESTAMP) {
            i++;
            if (i < 5) {
              this.binanceOpenPosition(i);
            } else {
              this.doNotDisturb = false;
              this.binanceOpenPosition(0, true);
            }
            return;
          }
          this.handleError(e);
          this.doNotDisturb = false;
        }
      }
    }
  }
  /** Check position */
  checkPosition(low: number, high: number, now: number) {
    if (this.ap && this.position) {
      if (!this.position.open) {
        if (this.checkPrice(low, high)) {
          this.position.open = true;
          this.result.all++;
        } else {
          this.ap = false;
        }
      } else if (this.position.open) {
        if (this.checkPrice(low, high, true)) {
          this.closePosition(now);
        }
      }
    }
  }
  /** Count SL price */
  private countSL(type: typeof SELL | typeof BUY, price: number, am: number, usable: number) {
    if (this.tpsl && this.tpsl.slP > 0) {
      return type === SELL
        ? this.math.round(
            (price * am * (this.tpsl.slP + 1 - (this.openFee + this.bigDefFee))) /
              (am * (1 + (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          )
        : this.math.round(
            (price * am * (this.tpsl.slP - 1 - (this.openFee + this.bigDefFee))) /
              (am * (this.openFee + this.bigDefFee - 1)),
            this.pricePrecision[this.pair],
            true,
          );
    }
    return type === SELL
      ? this.math.round(
          ((price * am * (1 + (this.openFee + this.bigDefFee)) + usable) /
            (am * (1 - (this.openFee + this.bigDefFee)))) *
            0.985,
          this.pricePrecision[this.pair],
          true,
        )
      : this.math.round(
          ((price * am * (1 - (this.openFee + this.bigDefFee)) - usable) /
            (am * (1 + (this.openFee + this.bigDefFee)))) *
            1.015,
          this.pricePrecision[this.pair],
          true,
        );
  }
  /** Count Trailing Stop Loss price */
  private countTSL(price: number) {
    if (this.tsl && this.position) {
      return this.position.type === SELL
        ? this.math.round(
            (price * this.position.amount * (this.tsl.tSlP + 1 - (this.openFee + this.bigDefFee))) /
              (this.position.amount * (1 + (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          )
        : this.math.round(
            (price * this.position.amount * (this.tsl.tSlP - 1 - (this.openFee + this.bigDefFee))) /
              (this.position.amount * (this.openFee + this.bigDefFee - 1)),
            this.pricePrecision[this.pair],
            true,
          );
    }
  }
  /** Count TP price */
  private countTP(type: typeof SELL | typeof BUY, price: number, am: number, tsl = false) {
    if (tsl && this.tsl) {
      return type === SELL
        ? this.math.round(
            (price * am * (1 - this.tsl.tSlP - (this.openFee + this.bigDefFee))) /
              (am * (1 + (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          )
        : this.math.round(
            (price * am * (this.tsl.tSlP + 1 + (this.openFee + this.bigDefFee))) /
              (am * (1 - (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          );
    }
    if (this.tpsl && this.tpsl.tpP > 0) {
      return type === SELL
        ? this.math.round(
            (price * am * (1 - this.tpsl.tpP - (this.openFee + this.bigDefFee))) /
              (am * (1 + (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          )
        : this.math.round(
            (price * am * (this.tpsl.tpP + 1 + (this.openFee + this.bigDefFee))) /
              (am * (1 - (this.openFee + this.bigDefFee))),
            this.pricePrecision[this.pair],
            true,
          );
    }
  }
  /** Generate position id */
  private getId(close?: boolean) {
    if (close) {
      return `c-${this.position?.id}`.substr(0, 36);
    }
    return `${this.name.substr(this.name.indexOf('_'), this.name.length)}-${new Date().getTime()}`.substr(0, 36);
  }
  /** Check position in realtime*/
  async checkPositionRt(now: number, time?: number) {
    this.lastPrice = this.now;
    this.now = now;
    if (this.bestPrice === 0) {
      this.bestPrice = Math.max(this.lastPrice, this.now);
    } else if (this.bestPrice !== 0 && this.position && this.ap) {
      this.bestPrice =
        this.position.type === 'SELL'
          ? this.now < this.bestPrice
            ? this.now
            : this.bestPrice
          : this.now > this.bestPrice
          ? this.now
          : this.bestPrice;
    }
    if (this.ap && this.position && (!this.useBinance || !this.client)) {
      if (!this.position.open) {
        const date = new Date().getTime();
        if (date - this.position.time >= this.timeout) {
          this.ap = false;
          this.result.notOpened++;
        } else {
          if (this.checkPriceRt(now)) {
            this.position.open = true;
            this.result.all++;
            this.write();
          }
        }
      } else if (this.position.open) {
        if (this.tsl && this.now !== 0 && this.lastPrice !== 0 && this.position.tslTrig) {
          if (this.position.type === 'SELL') {
            if (this.now < this.lastPrice && this.now <= this.position.tslTrig) {
              const tempTsl = this.countTSL(this.bestPrice);
              if (!this.position.tsl && tempTsl) {
                this.position.tsl = tempTsl;
              }
              if (tempTsl && this.position.tsl && tempTsl < this.position.tsl) {
                this.position.tsl = tempTsl;
              }
            }
          }
          if (this.position.type === 'BUY') {
            if (this.now > this.lastPrice && this.now >= this.position.tslTrig) {
              const tempTsl = this.countTSL(this.bestPrice);
              if (!this.position.tsl && tempTsl) {
                this.position.tsl = tempTsl;
              }
              if (tempTsl && this.position.tsl && tempTsl > this.position.tsl) {
                this.position.tsl = tempTsl;
              }
            }
          }
        }
        if (this.checkPriceRt(now, true)) {
          this.closePosition(now, false, undefined, undefined, undefined, time);
        }
      }
    }
    if (this.useBinance && this.client && this.ap && this.position && this.position.open && !this.closing) {
      if (this.tsl && this.now !== 0 && this.lastPrice !== 0 && this.position.tslTrig) {
        if (this.position.type === 'SELL') {
          if (this.now < this.lastPrice && this.now <= this.position.tslTrig) {
            const tempTsl = this.countTSL(this.bestPrice);
            if (!this.position.tsl && tempTsl) {
              this.position.tsl = tempTsl;
            }
            if (tempTsl && this.position.tsl && tempTsl < this.position.tsl) {
              this.position.tsl = tempTsl;
            }
          }
        }
        if (this.position.type === 'BUY') {
          if (this.now > this.lastPrice && this.now >= this.position.tslTrig) {
            const tempTsl = this.countTSL(this.bestPrice);
            if (!this.position.tsl && tempTsl) {
              this.position.tsl = tempTsl;
            }
            if (tempTsl && this.position.tsl && tempTsl > this.position.tsl) {
              this.position.tsl = tempTsl;
            }
          }
        }
      }
      if (this.checkPriceRt(now, true)) {
        this.closing = true;
        this.closePosition(now, false, typeof this.tpsl === 'undefined' || typeof this.tsl === 'undefined');
      }
    }
  }
  /** Check is position price fit in candle */
  private checkPrice(low: number, high: number, sl = false) {
    if (this.position) {
      if (sl) {
        return this.position.sl >= low && this.position.sl <= high;
      }
      return this.position.price >= low && this.position.price <= high;
    }
    return;
  }
  /** Check is position price already been */
  private checkPriceRt(now: number, sl = false) {
    if (this.position && this.ap) {
      if (sl) {
        if (this.tsl && this.position.sl && this.position.tsl) {
          if (this.position.type === SELL) {
            return this.position.sl <= now || this.position.tsl < now;
          } else if (this.position.type === BUY) {
            return this.position.sl >= now || this.position.tsl > now;
          }
        }
        if (this.tpsl && this.position.tp && this.position.sl) {
          if (this.position.type === SELL) {
            return this.position.sl <= now || this.position.tp > now;
          } else if (this.position.type === BUY) {
            return this.position.sl >= now || this.position.tp < now;
          }
        }
        if (this.position.type === SELL) {
          return this.position.sl <= now;
        } else if (this.position.type === BUY) {
          return this.position.sl >= now;
        }
      }
      if (this.position.type === SELL) {
        return this.position.price <= now;
      } else if (this.position.type === BUY) {
        return this.position.price >= now;
      }
    }
    return;
  }
  /** Close position */
  async closePosition(pr: number, reopen = false, market = false, cb?: () => void, i = 0, time?: number) {
    const handleError = (e: any) => {
      if (this.timer.close) {
        clearInterval(this.timer.close);
        this.timer.close = null;
      }
      if (e.code === ErrorCodes.INVALID_TIMESTAMP) {
        i++;
        this.closePosition(pr, reopen, market, cb, i, time);
        return;
      }
      this.handleError(e);
      this.closePosition(pr, reopen, market, cb, i, time);
    };
    const closePos = (res: QueryFuturesOrderResult, price: number, side: typeof SELL | typeof BUY) => {
      if (this.position) {
        this.position.closeBinance = res;
        this.doNotDisturb = false;
        this.position.partiallyFilled = res.status === 'PARTIALLY_FILLED';
        if (parseFloat(res.executedQty) <= this.position.origQty) {
          this.position.amount = this.position.origQty - parseFloat(res.executedQty);
          if (this.position.amount === 0) {
            this.position.amount = this.position.origQty;
          }
          this.position.cost = this.math.round((this.position.amount * this.position.price) / this.leverage);
        }
        if (parseFloat(res.avgPrice) !== price) {
          this.position.closeType = 'MARKET';
          this.closeFee = this.bigDefFee;
          price = parseFloat(res.avgPrice);
        }
        if (!this.position.partiallyFilled) {
          this.makeClose(price, cb, time);
          if (reopen) {
            this.openPosition(price, side);
          }
        }
      }
    };
    if (this.timer.open) {
      setTimeout(() => this.closePosition(pr, reopen, market, cb, i, time), 1000);
      return;
    }
    if (this.ap && this.position) {
      let price = pr;
      if (this.useBinance && this.client && this.bt) {
        if (this.position.partiallyFilled) {
          const cancelAllOpenOrders = await this.bt.cancelAllOpenOrders({ symbol: this.pair });
          if (cancelAllOpenOrders.status === 'NOTOK') {
            handleError(cancelAllOpenOrders.data);
          }
        }
        const side = this.position.type === 'SELL' ? 'BUY' : 'SELL';
        this.doNotDisturb = true;
        let order: NewFuturesOrder = {
          newClientOrderId: this.getId(true),
          price: this.math.round(price, this.pricePrecision[this.pair]),
          quantity: `${this.position.amount}`,
          side,
          symbol: this.pair,
          timeInForce: 'GTC',
          type: 'LIMIT',
          newOrderRespType: 'FULL',
          reduceOnly: 'true',
          recvWindow: this.rcvWindow,
        };
        this.position.closeType = 'LIMIT';
        if (market || i >= 2) {
          order = {
            newClientOrderId: this.getId(true),
            quantity: `${this.position.amount}`,
            side,
            symbol: this.pair,
            type: 'MARKET',
            newOrderRespType: 'FULL',
            reduceOnly: 'true',
            recvWindow: this.rcvWindow,
          };
          this.position.closeType = 'MARKET';
        }
        this.pending = true;
        const closeRequest = await this.bt.openOrder(order);
        this.pending = false;
        if (closeRequest.status === 'OK') {
          const closeRequestData = closeRequest.data;
          this.position.closeBinance = closeRequestData;
          if (closeRequestData.status === 'FILLED') {
            closePos(closeRequestData, price, side);
            this.doNotDisturb = false;
          } else {
            if (closeRequestData.status === 'PARTIALLY_FILLED') {
              closePos(closeRequestData, price, side);
            }
            this.timer.close = setInterval(async () => {
              if (this.client && this.position && this.position.closeBinance && !this.pending && this.bt) {
                this.pending = true;
                const getOrderRequest = await this.bt.getOrder({
                  origClientOrderId: this.position.closeBinance.clientOrderId,
                  symbol: this.pair,
                });
                this.pending = false;
                if (getOrderRequest.status === 'OK') {
                  const getOrderRequestData = getOrderRequest.data;
                  if (getOrderRequestData.status === 'FILLED') {
                    if (this.timer.close) {
                      clearInterval(this.timer.close);
                      this.timer.close = null;
                    }
                    closePos(getOrderRequestData, price, side);
                    this.doNotDisturb = false;
                  } else if (getOrderRequestData.status === 'PARTIALLY_FILLED') {
                    closePos(getOrderRequestData, price, side);
                  } else {
                    if (new Date().getTime() - getOrderRequestData.time >= this.timeout) {
                      this.pending = true;
                      const cancelOrderRequest = await this.bt.cancelOrder({
                        origClientOrderId: this.position.closeBinance.clientOrderId,
                        symbol: this.pair,
                      });
                      if (cancelOrderRequest.status === 'NOTOK') {
                        if (cancelOrderRequest.data.code !== -2011) {
                          return this.handleError(cancelOrderRequest.data);
                        }
                      }
                      const newOpenOrder = await this.bt.openOrder({
                        newClientOrderId: this.getId(true),
                        quantity: `${this.position.amount}`,
                        side,
                        symbol: this.pair,
                        type: 'MARKET',
                        newOrderRespType: 'RESULT',
                        reduceOnly: 'true',
                        recvWindow: this.rcvWindow,
                      });
                      this.pending = false;
                      if (newOpenOrder.status === 'OK') {
                        if (this.timer.close) {
                          clearInterval(this.timer.close);
                          this.timer.close = null;
                        }
                        closePos(newOpenOrder.data, price, side);
                        this.doNotDisturb = false;
                      } else if (newOpenOrder.status === 'NOTOK') {
                        if (newOpenOrder.data.code === -2022) {
                          const allOrders = await this.bt.allOrders({ symbol: this.pair, limit: 1 });
                          if (allOrders.status === 'OK') {
                            closePos(allOrders.data[0], price, side);
                            if (this.timer.close) {
                              clearInterval(this.timer.close);
                              this.timer.close = null;
                            }
                            this.doNotDisturb = false;
                            return;
                          }
                        }
                        this.doNotDisturb = false;
                        handleError(newOpenOrder.data);
                        return;
                      }
                    }
                  }
                } else if (getOrderRequest.status === 'NOTOK') {
                  if (getOrderRequest.data.code !== -1021) {
                    handleError(getOrderRequest.data);
                    this.doNotDisturb = false;
                    return;
                  }
                }
              }
            }, 2000);
          }
        } else if (closeRequest.status === 'NOTOK') {
          if (closeRequest.data.code === -2022) {
            const allOrders = await this.bt.allOrders({ symbol: this.pair, limit: 1 });
            if (allOrders.status === 'OK') {
              closePos(allOrders.data[0], price, side);
              this.doNotDisturb = false;
              return;
            }
          }
          if (closeRequest.data.code === ErrorCodes.INVALID_TIMESTAMP) {
            this.closePosition(pr, reopen, true, cb);
          }
          handleError(closeRequest.data);
          this.doNotDisturb = false;
          return;
        }
      } else {
        this.makeClose(price, cb, time);
      }
    }
  }
  /** Make close for test */
  private makeClose(price: number, cb?: () => void, time?: number) {
    if (this.ap && this.position) {
      const comission = (price * this.closeFee + this.position.price * this.openFee) * this.position.amount;
      const posRes =
        (this.position.type === BUY ? price - this.position.price : this.position.price - price) *
          this.position.amount -
        comission;
      this.wallet += posRes;
      if (this.wallet > this.fallMax) {
        if (this.fallMin !== 0) {
          const fall = (this.fallMax - this.fallMin) / this.fallMax;
          if (fall > this.fallPerc) {
            this.fallPerc = fall;
          }
          this.fallMin = 0;
        }
        this.fallMax = this.wallet;
      }
      if (this.wallet < this.fallMax) {
        if (this.fallMin === 0) {
          this.fallMin = this.wallet;
        } else {
          if (this.wallet < this.fallMin) {
            this.fallMin = this.wallet;
          }
        }
      }
      if (posRes > 0) {
        if (this.position.type === BUY) {
          this.result.profit.buy++;
          this.result.profit.buyAmount += posRes;
        }
        if (this.position.type === SELL) {
          this.result.profit.sell++;
          this.result.profit.sellAmount += posRes;
        }
        this.result.profit.amount += posRes;
      }
      if (posRes <= 0) {
        if (this.position.type === BUY) {
          this.result.loss.buy++;
          this.result.loss.buyAmount += posRes;
        }
        if (this.position.type === SELL) {
          this.result.loss.sell++;
          this.result.loss.sellAmount += posRes;
        }
        this.result.loss.amount += posRes;
      }
      this.result.net = this.result.profit.amount + this.result.loss.amount;
      this.position.closePrice = price;
      this.position.closeTime = time || new Date().getTime();
      if (time) {
        this.position.humanTime = this.timeAgo.format(this.position.time);
        this.position.humanCloseTime = this.timeAgo.format(this.position.closeTime);
      }
      this.position.net = this.math.round(posRes, 2, true);
      this.write();
      this.ap = false;
      if (cb) {
        cb();
      }
      if (this.cbClose) {
        this.cbClose(this.position.net);
      }
      this.closing = false;
      this.lastPrice = 0;
      this.bestPrice = 0;
      this.sent = false;
    }
  }
  /** Write to db */
  private write() {
    if (this.db && this.position) {
      const exist = this.db.read();
      this.position.humanTime = this.timeAgo.format(this.position.time);
      this.position.humanCloseTime = this.position.closeTime ? this.timeAgo.format(this.position.closeTime) : '';
      let toWrite = [this.position];
      if (exist) {
        const nonChanged = exist.filter((item) => item.name !== this.name);
        const changed = exist.filter((item) => item.name === this.name);
        const find = changed.findIndex((item) => item.id === this.position?.id);
        if (find !== -1) {
          changed.splice(find, 1, this.position);
        } else {
          changed.push(this.position);
        }
        toWrite = [...nonChanged, ...changed];
      }
      this.db.write(toWrite);
    }
  }
  /** Stop bot */
  stop() {
    if (this.timer.close) {
      clearInterval(this.timer.close);
      this.timer.close = null;
    }
    if (this.timer.open) {
      clearInterval(this.timer.open);
      this.timer.open = null;
    }
  }
  /** Get positions history */
  history(ind = 0) {
    if (this.db) {
      const tmp = this.db.read();
      if (tmp) {
        const botHist = tmp.filter((item) => item.name === this.name && item.closePrice);
        const next = typeof botHist[ind - 5] === 'undefined' ? undefined : ind - 5;
        const prev = typeof botHist[ind + 5] === 'undefined' ? undefined : ind + 5;
        return {
          data: botHist
            .sort((a, b) => b.time - a.time)
            .slice(ind, ind + 5)
            .sort((a, b) => a.time - b.time),
          next,
          prev,
          length: botHist.length,
        };
      }
    }
  }
  /** Get current position */
  get currentPosition() {
    if (this.position && this.position.open && this.ap) {
      const posRes =
        this.position.type === SELL
          ? this.math.round((this.position.price - this.now) * this.position.amount)
          : this.math.round((this.now - this.position.price) * this.position.amount);
      const comission = (this.now * this.closeFee + this.position.price * this.openFee) * this.position.amount;
      return {
        ...this.position,
        status: this.now === 0 ? 'н/д' : this.math.round(posRes - comission),
        PnL: this.now === 0 ? 'н/д' : `${this.math.round((posRes / this.position.cost) * 100, 0)}%`,
      };
    }
    return;
  }
  /** Get current position */
  get currentResult() {
    let fall = this.fallPerc;
    if (this.fallMin !== 0) {
      const nowFall = (this.fallMax - this.fallMin) / this.fallMax;
      if (nowFall > fall) {
        fall = nowFall;
      }
    }
    return {
      ago: `${this.timeAgo.calc(this.start)} (${this.timeAgo.format(this.start)})`,
      leverage: this.leverage,
      wallet: this.math.round(this.wallet),
      now: this.now,
      all: this.result.all,
      profit: {
        amount: this.math.round(this.result.profit.amount),
        buy: this.result.profit.buy,
        sell: this.result.profit.sell,
        buyAmount: this.math.round(this.result.profit.buyAmount),
        sellAmount: this.math.round(this.result.profit.sellAmount),
      },
      loss: {
        amount: this.math.round(this.result.loss.amount),
        buy: this.result.loss.buy,
        sell: this.result.loss.sell,
        buyAmount: this.math.round(this.result.loss.buyAmount),
        sellAmount: this.math.round(this.result.loss.sellAmount),
      },
      notOpened: this.result.notOpened,
      net: this.math.round(this.result.net),
      hist: this.historyResult,
      fall,
    };
  }
  /** Is some position active */
  get active() {
    return this.ap;
  }
  /** Get position type */
  get type() {
    return this.position?.type;
  }
  /** Get history length */
  get historyLength() {
    if (this.db) {
      const tmp = this.db.read();
      if (tmp) {
        const botHist = tmp.filter((item) => item.name === this.name && item.closePrice);
        return botHist.length;
      }
    }
  }
}
