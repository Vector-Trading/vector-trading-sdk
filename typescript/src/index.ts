export { RestClient, SignalsClient } from './clients.js';
export type { RestClientOptions, SignalsClientOptions, SendSignalRequest } from './clients.js';
export { SdkError } from './errors.js';
export type { ErrorKind } from './errors.js';
export type { Fetch, TransportOptions, RequestOptions } from './transport.js';
export {
  buildSignal,
  buildOpenSignal,
  buildUpdateSignal,
  buildCancelSignal,
  buildCloseSignal,
  buildStartSignal,
  buildPauseSignal,
  buildStopSignal,
  buildDeleteSignal,
  serializeSignal,
} from './signals.js';
export type { SignalInput, BuilderInput, StrategySignalPayload } from './signals.js';
export type {
  ListBundlesRequest,
  SearchUsersRequest,
  GetCheckoutRequest,
  ListBundleUsersRequest,
  ListBundleGrantsRequest,
  CreateBundleGrantRequest,
  RevokeBundleGrantRequest,
} from '../../generation/generated/typescript/apis/DefaultApi.js';
export type {
  BundlesResponse,
  UsersSearchResponse,
  CheckoutDetails,
  BundleUsersResponse,
  BundleGrantsResponse,
  GrantMutationResponse,
  CreateGrantRequest,
  OtherGrantRequest,
  PaidExternalGrantRequest,
  CheckoutDetailsDiscount,
  OpenSignalPayloadOrderTakeProfitsInner,
  OwnedTradingBundleSummary,
  PublicUser,
  TradingBundleAccessGrantSummary,
  TradingBundleGrantedUser,
  OpenSignalPayload,
  UpdateSignalPayload,
  CancelSignalPayload,
  CloseSignalPayload,
  StartSignalPayload,
  PauseSignalPayload,
  StopSignalPayload,
  DeleteSignalPayload,
  OpenSignalPayloadOrder,
  UpdateSignalPayloadOrder,
} from '../../generation/generated/typescript/models/index.js';

// Explicit aliases prevent the declaration bundler from advertising runtime enum values.
import type {
  CheckoutDetailsDiscountTypeEnum as GeneratedCheckoutDetailsDiscountTypeEnum,
  OtherGrantRequestGrantTypeEnum as GeneratedOtherGrantRequestGrantTypeEnum,
  PaidExternalGrantRequestGrantTypeEnum as GeneratedPaidExternalGrantRequestGrantTypeEnum,
  OwnedTradingBundleSummaryAccessEnum as GeneratedOwnedTradingBundleSummaryAccessEnum,
  OwnedTradingBundleSummaryStatusEnum as GeneratedOwnedTradingBundleSummaryStatusEnum,
  OpenSignalPayloadOrderSideEnum as GeneratedOpenSignalPayloadOrderSideEnum,
  UpdateSignalPayloadOrderSideEnum as GeneratedUpdateSignalPayloadOrderSideEnum,
  OpenSignalPayloadActionEnum as GeneratedOpenSignalPayloadActionEnum,
  UpdateSignalPayloadActionEnum as GeneratedUpdateSignalPayloadActionEnum,
  CancelSignalPayloadActionEnum as GeneratedCancelSignalPayloadActionEnum,
  CloseSignalPayloadActionEnum as GeneratedCloseSignalPayloadActionEnum,
  StartSignalPayloadActionEnum as GeneratedStartSignalPayloadActionEnum,
  PauseSignalPayloadActionEnum as GeneratedPauseSignalPayloadActionEnum,
  StopSignalPayloadActionEnum as GeneratedStopSignalPayloadActionEnum,
  DeleteSignalPayloadActionEnum as GeneratedDeleteSignalPayloadActionEnum,
  TradingBundleAccessGrantType as GeneratedTradingBundleAccessGrantType,
} from '../../generation/generated/typescript/models/index.js';
import type {
  ListBundleGrantsSortEnum as GeneratedListBundleGrantsSortEnum,
  ListBundleGrantsDirEnum as GeneratedListBundleGrantsDirEnum,
} from '../../generation/generated/typescript/apis/DefaultApi.js';
export type CheckoutDetailsDiscountTypeEnum = GeneratedCheckoutDetailsDiscountTypeEnum;
export type OtherGrantRequestGrantTypeEnum = GeneratedOtherGrantRequestGrantTypeEnum;
export type PaidExternalGrantRequestGrantTypeEnum = GeneratedPaidExternalGrantRequestGrantTypeEnum;
export type OwnedTradingBundleSummaryAccessEnum = GeneratedOwnedTradingBundleSummaryAccessEnum;
export type OwnedTradingBundleSummaryStatusEnum = GeneratedOwnedTradingBundleSummaryStatusEnum;
export type OpenSignalPayloadOrderSideEnum = GeneratedOpenSignalPayloadOrderSideEnum;
export type UpdateSignalPayloadOrderSideEnum = GeneratedUpdateSignalPayloadOrderSideEnum;
export type ListBundleGrantsSortEnum = GeneratedListBundleGrantsSortEnum;
export type ListBundleGrantsDirEnum = GeneratedListBundleGrantsDirEnum;
export type OpenSignalPayloadActionEnum = GeneratedOpenSignalPayloadActionEnum;
export type UpdateSignalPayloadActionEnum = GeneratedUpdateSignalPayloadActionEnum;
export type CancelSignalPayloadActionEnum = GeneratedCancelSignalPayloadActionEnum;
export type CloseSignalPayloadActionEnum = GeneratedCloseSignalPayloadActionEnum;
export type StartSignalPayloadActionEnum = GeneratedStartSignalPayloadActionEnum;
export type PauseSignalPayloadActionEnum = GeneratedPauseSignalPayloadActionEnum;
export type StopSignalPayloadActionEnum = GeneratedStopSignalPayloadActionEnum;
export type DeleteSignalPayloadActionEnum = GeneratedDeleteSignalPayloadActionEnum;
export type TradingBundleAccessGrantType = GeneratedTradingBundleAccessGrantType;
