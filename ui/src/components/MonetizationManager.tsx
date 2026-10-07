import React, { useState, useEffect, useMemo } from 'react';
import {
  Coins,
  Wallet,
  FileSpreadsheet,
  Layers,
  RefreshCw,
  Save,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Search,
  Calculator,
  RotateCcw,
  X,
  CreditCard,
  User,
  Users,
  Box,
  Cpu,
  Tag,
  Code2,
  Brain,
  Zap,
  Route,
  MessageSquare,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  ShieldCheck,
  GitCompare,
  GitPullRequest,
  Lock,
} from 'lucide-react';
import {
  fetchModelRates,
  updateModelRates,
  fetchDeveloperBalance,
  creditDeveloperBalance,
  fetchRatePlans,
  fetchDeveloperSubscriptions,
  subscribeDeveloper,
  fetchDeveloperMonetizationConfig,
  updateDeveloperMonetizationConfig,
  fetchDeveloperAttributions,
  fetchAiProducts,
  updateAiProduct,
  resetAiProduct,
} from '../services/api';
import {
  RateCardDictionary,
  RatePlanInfo,
  DeveloperSubscription,
  DeveloperMonetizationConfig,
  GatewaySettings,
  UserMonetizationAttribution,
  ApiProduct,
} from '../types';
import { DEFAULT_SSO_USER } from '../services/defaultSettings';
import { GoogleLogo, AnthropicLogo } from './ProviderLogos';
import { PERSONAS } from '../utils/personas';
import { displayPersona } from '../utils/customerTheme';
import { roleCan, roleCanSeeTab, roleCanSeeSection } from '../utils/adminRoles';
import type { AdminCapability, AdminRole } from '../utils/adminRoles';
import { RoleGate, RoleNoticeModal } from './AdminRoleGate';
import { GuardrailsPoliciesView } from './GuardrailsPoliciesView';
import { EnvCompareModal } from './EnvCompareModal';
import { PROD_READ_ONLY_MESSAGE } from '../utils/configDiff';
import { say, term, Term, voiceForAdminRole, speak, speakerForAdminRole } from '../utils/voice';
import type { Lines } from '../utils/voice';
import {
  sortDeveloperList,
  sortAttributionTable,
  defaultAttributionSortDirection,
  type AttributionSortColumn,
  type SortDirection,
} from '../utils/monetizationSort';

// Provider logo/mark component replacing raw GOOG/ANTH text badges
/** Friendly persona label for a persona API product name. */
const personaByProduct = (product: string) =>
  (() => { const p = PERSONAS.find((x) => x.product === product); return p ? displayPersona(p).label : product; })();

const ModelProviderIcon = ({ model }: { model: string }) => {
  if (model === 'auto') {
    return (
      <div className="w-8 h-8 rounded-xl bg-purple-100 border border-purple-200 flex items-center justify-center text-purple-700 shadow-2xs shrink-0" title="Apigee Semantic Router">
        <Route className="w-4 h-4 text-purple-600" />
      </div>
    );
  }
  if (model.startsWith('gemini') || model.startsWith('gemma')) {
    return (
      <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-2xs shrink-0" title="Google DeepMind / Vertex AI">
        <GoogleLogo className="w-4.5 h-4.5" />
      </div>
    );
  }
  if (model.startsWith('claude')) {
    return (
      <div className="w-8 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center shadow-2xs shrink-0" title="Anthropic on Vertex AI">
        <AnthropicLogo className="w-4.5 h-4.5" />
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shadow-2xs shrink-0" title="LLM">
      <Cpu className="w-4 h-4 text-slate-600" />
    </div>
  );
};

const CATALOG_MODELS = [
  { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', provider: 'google', desc: 'Ultra-low latency, cost-effective' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', provider: 'google', desc: 'Flagship fast multimodal reasoning' },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', provider: 'google', desc: 'Frontier reasoning & advanced coding' },
  { id: 'claude-haiku-4-5@20251001', name: 'Claude 4.5 Haiku', provider: 'anthropic', desc: 'Lightweight Anthropic model (300 tpm token-quota demo: 3 calls, then 429)' },
  { id: 'claude-opus-4-5@20251101', name: 'Claude 4.5 Opus', provider: 'anthropic', desc: 'Anthropic flagship reasoning model' },
  { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', provider: 'google', desc: 'Hybrid reasoning model' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google', desc: 'Next-gen flash model' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google', desc: 'Stable legacy flash model' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'google', desc: 'Stable legacy pro model' },
];

interface MonetizationManagerProps {
  currentEnv?: 'dev' | 'prod';
  settings?: GatewaySettings;
  /** Opens the Architecture blueprint on a specific gateway pipeline. */
  onInspectArchitecture?: (flow: 'ai-gateway' | 'mcp-gateway') => void;
  /** Admin persona: which areas may be changed (see utils/adminRoles.js). Defaults to Platform Admin. */
  adminRole?: AdminRole;
  onAdminRoleChange?: (role: AdminRole) => void;
}

type MonetizationSubTab = 'products' | 'wallets' | 'rate-cards' | 'rate-plans' | 'policies';

export const MonetizationManager: React.FC<MonetizationManagerProps> = ({
  currentEnv = 'prod',
  settings,
  onInspectArchitecture,
  adminRole = 'platform',
  onAdminRoleChange,
}) => {
  /*
    Persona voice: Platform Admin reads Apigee terms, Finance and AI CoE read plain
    business wording. `byRole` lets Finance and AI CoE copy differ where it helps.
    `sp` picks one line per speaker (platform / finance / ai_coe): Platform Admin
    copy talks operations (what enforces it, what happens on a violation, the
    Dev -> PR -> Prod rollout, blast radius); Finance talks spend; AI CoE talks
    model strategy and safety. Only the areas a role can see need its own line.
  */
  const voice = voiceForAdminRole(adminRole);
  const speaker = speakerForAdminRole(adminRole);
  const sp = <T,>(lines: Lines<T>): T => speak(speaker, lines);
  const s = <T,>(technical: T, business: T): T => say(voice, technical, business);
  const byRole = <T,>(technical: T, finance: T, aiCoe: T): T =>
    adminRole === 'finance' ? finance : adminRole === 'ai_coe' ? aiCoe : technical;
  const devLabel = term(voice, 'devEnv');
  const prodLabel = term(voice, 'prodEnv');
  const billingLabel = (type: string) =>
    s(type, type === 'PREPAID' ? 'Prepaid' : type === 'POSTPAID' ? 'Invoiced monthly' : type);
  const [activeSubTab, setActiveSubTab] = useState<MonetizationSubTab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('subtab') as MonetizationSubTab;
      if (p && ['products', 'wallets', 'rate-cards', 'rate-plans', 'policies'].includes(p)) {
        return p;
      }
    }
    return 'products';
  });
  /*
    Dev / Prod view. Prod is read-only: saves are refused (here and, authoritatively,
    by the server) with the "raise a pull request" message. Dev edits the "(Dev)"
    sandbox products and dev KVM that Ask Apigee also changes.
  */
  const [env, setEnv] = useState<'dev' | 'prod'>(currentEnv);
  const isProdView = env === 'prod';
  const [showProdNotice, setShowProdNotice] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  /** Returns true (and explains why) when a write is attempted in the Prod view. */
  const blockProdWrite = () => {
    if (!isProdView) return false;
    setShowProdNotice(true);
    return true;
  };

  /*
    Admin persona. Finance owns cost (budgets, wallets, pricing, rate plans), the
    AI CoE owns models, quotas, routing and guardrails, Platform Admin owns all.
    Edit forms are wrapped in <RoleGate> (disabled fieldset); handlers are also
    guarded so views that stay interactive (search, sort) cannot write.
  */
  const [roleNotice, setRoleNotice] = useState<AdminCapability | null>(null);
  /** Returns true (and says who owns it) when the admin persona does not own `capability`. */
  const blockRoleWrite = (capability: AdminCapability) => {
    if (roleCan(adminRole, capability)) return false;
    setRoleNotice(capability);
    return true;
  };

  // Active Developer for Monetization
  const defaultEmail = settings?.ssoUser?.email || settings?.userEmail || DEFAULT_SSO_USER.email;
  const [selectedDeveloper, setSelectedDeveloper] = useState<string>(defaultEmail);

  useEffect(() => {
    if (defaultEmail && (selectedDeveloper === DEFAULT_SSO_USER.email || !selectedDeveloper)) {
      setSelectedDeveloper(defaultEmail);
    }
  }, [defaultEmail]);

  // Global Alert / Notification state
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // -------------------------------------------------------------
  // 0. AI Products & Entitlements State
  // -------------------------------------------------------------
  const [products, setProducts] = useState<ApiProduct[]>([]);
  const [, setProductDefaults] = useState<Record<string, ApiProduct>>({});
  const [editedProducts, setEditedProducts] = useState<Record<string, ApiProduct>>({});
  const [selectedProductName, setSelectedProductName] = useState<string>(PERSONAS[0].product);
  const [productConfigSection, setProductConfigSection] = useState<'models' | 'routing' | 'budget' | 'custom'>('models');
  /*
    Each admin persona only sees the sub-tabs and product sections it owns; the rest
    are hidden. When the persona changes (or ?subtab= points at a hidden tab), move
    to the first one it can see.
  */
  useEffect(() => {
    if (!roleCanSeeTab(adminRole, activeSubTab)) {
      const first = (['products', 'wallets', 'rate-cards', 'rate-plans', 'policies'] as const).find((t) => roleCanSeeTab(adminRole, t));
      if (first) setActiveSubTab(first);
    }
    if (!roleCanSeeSection(adminRole, productConfigSection)) {
      const first = (['models', 'routing', 'budget', 'custom'] as const).find((c) => roleCanSeeSection(adminRole, c));
      if (first) setProductConfigSection(first);
    }
  }, [adminRole, activeSubTab, productConfigSection]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [productResetting, setProductResetting] = useState(false);
  const [showProductResetModal, setShowProductResetModal] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');
  const [newCustomAttrKey, setNewCustomAttrKey] = useState('');
  const [newCustomAttrVal, setNewCustomAttrVal] = useState('');

  const activeProduct = editedProducts[selectedProductName] || products.find((p) => p.name === selectedProductName);
  const originalProduct = products.find((p) => p.name === selectedProductName);
  const hasProductChanges = useMemo(() => {
    if (!activeProduct || !originalProduct) return false;
    return JSON.stringify(activeProduct) !== JSON.stringify(originalProduct);
  }, [activeProduct, originalProduct]);

  const loadAiProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await fetchAiProducts(env);
      // Always replace: switching Dev <-> Prod must never leave the other env's products on screen.
      const list = res.products || [];
      setProducts(list);
      setProductDefaults(res.defaults || {});
      const edits: Record<string, ApiProduct> = {};
      list.forEach((p) => {
        edits[p.name] = JSON.parse(JSON.stringify(p));
      });
      setEditedProducts(edits);
    } catch (err: any) {
      console.warn('Failed to load AI products:', err.message);
    } finally {
      setProductsLoading(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!activeProduct) return;
    if (blockProdWrite()) return;
    setProductSaving(true);
    setError(null);
    try {
      const res = await updateAiProduct(selectedProductName, activeProduct, env);
      setProducts((prev) => prev.map((p) => (p.name === selectedProductName ? res.product : p)));
      setEditedProducts((prev) => ({
        ...prev,
        [selectedProductName]: JSON.parse(JSON.stringify(res.product)),
      }));
      setSuccessMessage(sp({
        technical: `Wrote ${res.product?.apigeeName || selectedProductName} (Dev) via the Management API. Dev proxies enforce it on the next call; Prod is untouched until a PR merges.`,
        finance: `Saved the ${personaByProduct(selectedProductName)} budget in the Sandbox. Live spend limits change only after approval.`,
        ai_coe: `Saved ${personaByProduct(selectedProductName)} models and routing in the Sandbox. Try them in the playground before they go Live.`,
      }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Management API rejected the product update. Dev enforcement is unchanged.',
        finance: 'Could not save this budget. The previous limit still applies.',
        ai_coe: 'Could not save these model settings. The previous ones still apply.',
      }));
    } finally {
      setProductSaving(false);
    }
  };

  const handleResetProduct = async (name: string) => {
    setShowProductResetModal(false);
    if (blockRoleWrite('reset')) return;
    if (blockProdWrite()) return;
    setProductResetting(true);
    setError(null);
    try {
      await resetAiProduct(name, env);
      await loadAiProducts();
      setSuccessMessage(
        name === 'all'
          ? sp({
              technical: 'Re-cloned every Prod product into Dev. Unmerged Dev edits are gone; Dev proxies now enforce the Prod config.',
              business: 'All Sandbox personas now match Live',
            })
          : sp({
              technical: `Re-cloned ${name} from Prod into Dev. Its unmerged Dev edits are gone; other products are untouched.`,
              business: `${personaByProduct(name)} (Sandbox) now matches Live`,
            })
      );
      setTimeout(() => setSuccessMessage(null), 4500);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Reset from Prod failed. Dev keeps its current (possibly edited) config.',
        business: 'Could not reset this persona',
      }));
    } finally {
      setProductResetting(false);
    }
  };

  const handleRevertProduct = () => {
    if (!originalProduct) return;
    setEditedProducts((prev) => ({
      ...prev,
      [selectedProductName]: JSON.parse(JSON.stringify(originalProduct)),
    }));
  };

  const updateCurrentProduct = (updater: (p: ApiProduct) => void) => {
    if (!activeProduct) return;
    const clone: ApiProduct = JSON.parse(JSON.stringify(activeProduct));
    updater(clone);
    setEditedProducts((prev) => ({
      ...prev,
      [selectedProductName]: clone,
    }));
  };

  const configuredModels = useMemo(() => {
    if (!activeProduct?.llmOperationGroup?.operationConfigs) return [];
    const configs = activeProduct.llmOperationGroup.operationConfigs;
    const map = new Map<string, {
      model: string;
      resource: string;
      limit: string;
      interval: string;
      timeUnit: string;
    }>();

    configs.forEach((cfg) => {
      cfg.llmOperations?.forEach((op) => {
        const m = op.model;
        if (!map.has(m)) {
          map.set(m, {
            model: m,
            resource: op.resource,
            limit: cfg.llmTokenQuota?.limit || '2000',
            interval: cfg.llmTokenQuota?.interval || '1',
            timeUnit: cfg.llmTokenQuota?.timeUnit || 'minute',
          });
        }
      });
    });

    return Array.from(map.values());
  }, [activeProduct]);

  const handleUpdateModelQuota = (modelName: string, field: 'limit' | 'interval' | 'timeUnit', val: string) => {
    if (blockRoleWrite('quota')) return;
    updateCurrentProduct((p) => {
      p.llmOperationGroup?.operationConfigs?.forEach((cfg) => {
        if (cfg.llmOperations?.some((op) => op.model === modelName)) {
          if (!cfg.llmTokenQuota) {
            cfg.llmTokenQuota = { limit: '2000', interval: '1', timeUnit: 'minute' };
          }
          cfg.llmTokenQuota[field] = val;
        }
      });
    });
  };

  const handleRemoveModel = (modelName: string) => {
    if (blockRoleWrite('models')) return;
    updateCurrentProduct((p) => {
      if (!p.llmOperationGroup?.operationConfigs) return;
      p.llmOperationGroup.operationConfigs = p.llmOperationGroup.operationConfigs.filter(
        (cfg) => !cfg.llmOperations?.some((op) => op.model === modelName)
      );
    });
  };

  const handleAddProductModel = (modelName: string, defaultQuota = { limit: '2000', interval: '1', timeUnit: 'minute' }) => {
    if (blockRoleWrite('models')) return;
    const trimmed = modelName.trim();
    if (!trimmed) return;
    updateCurrentProduct((p) => {
      if (!p.llmOperationGroup) p.llmOperationGroup = { operationConfigs: [] };
      if (!p.llmOperationGroup.operationConfigs) p.llmOperationGroup.operationConfigs = [];
      const exists = p.llmOperationGroup.operationConfigs.some((cfg) =>
        cfg.llmOperations?.some((op) => op.model === trimmed)
      );
      if (exists) return;

      if (trimmed === 'auto') {
        p.llmOperationGroup.operationConfigs.push(
          {
            apiSource: 'ai-gateway-v1',
            llmOperations: [{ resource: '/auto', methods: ['POST'], model: 'auto' }],
            llmTokenQuota: { ...defaultQuota },
          },
          {
            apiSource: 'ai-gateway-v1',
            llmOperations: [{ resource: '/auto:*', methods: ['POST'], model: 'auto' }],
            llmTokenQuota: { ...defaultQuota },
          }
        );
      } else {
        p.llmOperationGroup.operationConfigs.push({
          apiSource: 'ai-gateway-v1',
          llmOperations: [{ resource: `/models/${trimmed}:*`, methods: ['POST'], model: trimmed }],
          llmTokenQuota: { ...defaultQuota },
        });
      }
    });
    setCustomModelInput('');
  };

  const getProductAttr = (name: string): string => {
    const found = activeProduct?.attributes?.find((a) => a.name === name);
    return found ? found.value : '';
  };

  const setProductAttr = (name: string, value: string) => {
    updateCurrentProduct((p) => {
      if (!p.attributes) p.attributes = [];
      const idx = p.attributes.findIndex((a) => a.name === name);
      if (idx >= 0) {
        p.attributes[idx].value = value;
      } else {
        p.attributes.push({ name, value });
      }
    });
  };

  const removeProductAttr = (name: string) => {
    updateCurrentProduct((p) => {
      if (!p.attributes) return;
      p.attributes = p.attributes.filter((a) => a.name !== name);
    });
  };

  const customAttributesList = useMemo(() => {
    return (activeProduct?.attributes || []).filter(
      (a: { name: string; value: string }) =>
        !a.name.startsWith('routing.model.') &&
        !a.name.startsWith('developer.budget.')
    );
  }, [activeProduct]);

  const budgetMicros = parseInt(getProductAttr('developer.budget.limit') || '0', 10);
  const budgetUsd = !isNaN(budgetMicros) && budgetMicros > 0 ? (budgetMicros / 1000000).toFixed(2) : '0.00';

  const handleBudgetUsdChange = (val: string) => {
    if (blockRoleWrite('budget')) return;
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return;
    const micros = Math.round(num * 1000000).toString();
    setProductAttr('developer.budget.limit', micros);
  };

  // -------------------------------------------------------------
  // 1. Developer Wallet & Monetization Config State
  // -------------------------------------------------------------
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<{
    units: string;
    nanos: number;
    currencyCode: string;
    lastCreditTime?: string;
  }>({
    units: '100',
    nanos: 0,
    currencyCode: 'USD',
  });
  const [monetizationConfig, setMonetizationConfig] = useState<DeveloperMonetizationConfig>({
    billingType: 'PREPAID',
  });
  const [configSaving, setConfigSaving] = useState(false);
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [customTopUpAmount, setCustomTopUpAmount] = useState('25');
  const [showCustomTopUpModal, setShowCustomTopUpModal] = useState(false);
  const [isSimulatingExhaustedWallet, setIsSimulatingExhaustedWallet] = useState(false);
  const [userAttributionSearch, setUserAttributionSearch] = useState('');

  // -------------------------------------------------------------
  // 2. KVM Model Rate Cards State
  // -------------------------------------------------------------
  const [rates, setRates] = useState<RateCardDictionary>({});
  const [initialRates, setInitialRates] = useState<RateCardDictionary>({});
  const [ratesLoading, setRatesLoading] = useState(false);
  const [ratesSaving, setRatesSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterProvider, setFilterProvider] = useState<'all' | 'google' | 'anthropic'>('all');

  // Add Model Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newProvider, setNewProvider] = useState<'google' | 'anthropic'>('google');
  const [newTier, setNewTier] = useState<'low' | 'medium' | 'high'>('medium');
  const [newInputRate, setNewInputRate] = useState('0.15');
  const [newOutputRate, setNewOutputRate] = useState('0.60');

  // Interactive Calculator State
  const [calcModel, setCalcModel] = useState<string>('gemini-3-flash-preview');
  const [calcPromptTokens, setCalcPromptTokens] = useState<number>(2500);
  const [calcOutputTokens, setCalcOutputTokens] = useState<number>(800);

  // -------------------------------------------------------------
  // 3. Product Rate Plans & Subscriptions State
  // -------------------------------------------------------------
  const [plansLoading, setPlansLoading] = useState(false);
  const [ratePlans, setRatePlans] = useState<RatePlanInfo[]>([]);
  const [subscriptions, setSubscriptions] = useState<DeveloperSubscription[]>([]);
  const [subscribingProduct, setSubscribingProduct] = useState<string | null>(null);
  const [liveAttributions, setLiveAttributions] = useState<UserMonetizationAttribution[]>([]);

  // Available Developers loaded dynamically from Management API (sorted alphabetically by name)
  const availableDevelopers = useMemo(() => {
    if (liveAttributions.length > 0) {
      const list = liveAttributions.map((a) => ({
        email: a.userEmail,
        name: a.name || a.userEmail.split('@')[0],
        badge: a.badge,
      }));
      return sortDeveloperList(list);
    }
    return [
      { email: defaultEmail, name: defaultEmail.split('@')[0], badge: 'SSO Caller' },
    ];
  }, [liveAttributions, defaultEmail]);

  // Load Developer Wallet & Monetization Config
  const loadWalletData = async (dev: string) => {
    setWalletLoading(true);
    try {
      const [balRes, cfgRes] = await Promise.all([
        fetchDeveloperBalance(dev).catch(() => null),
        fetchDeveloperMonetizationConfig(dev).catch(() => null),
      ]);

      if (balRes?.data?.wallets && balRes.data.wallets.length > 0) {
        const primary = balRes.data.wallets[0];
        setWalletBalance({
          units: primary.balance.units,
          nanos: primary.balance.nanos,
          currencyCode: primary.balance.currencyCode || 'USD',
          lastCreditTime: primary.lastCreditTime,
        });
      } else {
        setWalletBalance({ units: '0', nanos: 0, currencyCode: 'USD' });
      }

      if (cfgRes?.config?.billingType) {
        setMonetizationConfig(cfgRes.config);
      }
    } catch (err: any) {
      console.warn('Failed to load wallet data:', err.message);
    } finally {
      setWalletLoading(false);
    }
  };

  // Load KVM Model Rate Cards
  const loadKvmRates = async () => {
    setRatesLoading(true);
    try {
      const data = await fetchModelRates(env);
      setRates(data.rates || {});
      setInitialRates(JSON.parse(JSON.stringify(data.rates || {})));
      if (data.rates && !data.rates[calcModel]) {
        setCalcModel(Object.keys(data.rates)[0] || 'default');
      }
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Could not read the rate-card KVM. Proxies keep metering with the rates they last loaded.',
        finance: 'Could not load model prices. Usage is still charged at the last saved prices.',
      }));
    } finally {
      setRatesLoading(false);
    }
  };

  // Load Published Rate Plans & Subscriptions
  const loadPlansAndSubscriptions = async (dev: string) => {
    setPlansLoading(true);
    try {
      const [rpRes, subRes] = await Promise.all([
        fetchRatePlans().catch(() => ({ ratePlans: [] })),
        fetchDeveloperSubscriptions(dev).catch(() => ({ subscriptions: [] })),
      ]);
      setRatePlans(rpRes.ratePlans || []);
      setSubscriptions(subRes.subscriptions || []);
    } catch (err: any) {
      console.warn('Failed to load rate plans or subscriptions:', err.message);
    } finally {
      setPlansLoading(false);
    }
  };

  // Load Developer Attributions from Management API
  const loadAttributions = async () => {
    try {
      const data = await fetchDeveloperAttributions();
      if (data.attributions && data.attributions.length > 0) {
        setLiveAttributions(data.attributions);
      }
    } catch (err: any) {
      console.warn('Failed to load developer attributions:', err.message);
    }
  };

  // Master Refresh
  const handleRefreshAll = async (isManual = false) => {
    setError(null);
    await Promise.all([
      loadAiProducts(),
      loadWalletData(selectedDeveloper),
      loadKvmRates(),
      loadPlansAndSubscriptions(selectedDeveloper),
      loadAttributions(),
    ]);
    if (isManual) {
      setSuccessMessage(sp({
        technical: `Re-read products, wallets, rate-card KVM and rate plans (${env === 'prod' ? 'Prod' : 'Dev'})`,
        finance: 'Refreshed budgets, prepaid credit, prices and billing plans',
        ai_coe: 'Refreshed models, routing and safety settings',
      }));
      setTimeout(() => setSuccessMessage(null), 3500);
    }
  };

  useEffect(() => {
    handleRefreshAll(false);
  }, [selectedDeveloper, defaultEmail, env]);

  // Wallet Top-Up Action
  const handleCreditWallet = async (amountStr: string) => {
    if (blockRoleWrite('wallet')) return;
    const num = parseFloat(amountStr);
    if (isNaN(num) || num <= 0) return;

    setTopUpLoading(true);
    setError(null);
    try {
      await creditDeveloperBalance(amountStr, selectedDeveloper);
      await loadWalletData(selectedDeveloper);
      setIsSimulatingExhaustedWallet(false);
      setSuccessMessage(sp({
        technical: `Credited +$${amountStr} USD to ${selectedDeveloper}'s wallet. Their next call passes the balance check instead of being refused.`,
        finance: `Added $${amountStr} USD of prepaid credit for ${selectedDeveloper}. It can be spent straight away.`,
      }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Wallet credit call failed. Balance unchanged; calls are still checked against the old balance.',
        finance: 'Could not add prepaid credit. The balance has not changed.',
      }));
    } finally {
      setTopUpLoading(false);
      setShowCustomTopUpModal(false);
    }
  };

  // Toggle Billing Type (PREPAID vs POSTPAID)
  const handleToggleBillingType = async () => {
    if (blockRoleWrite('wallet')) return;
    const newType = monetizationConfig.billingType === 'PREPAID' ? 'POSTPAID' : 'PREPAID';
    setConfigSaving(true);
    setError(null);
    try {
      await updateDeveloperMonetizationConfig(newType, selectedDeveloper);
      setMonetizationConfig({ billingType: newType });
      setSuccessMessage(sp({
        technical: `Billing type set to ${newType}. ${newType === 'PREPAID' ? 'Calls are now refused once the wallet reaches $0.' : 'No balance check any more; usage accrues for the invoice.'}`,
        finance: `This user is now billed ${newType === 'PREPAID' ? 'from prepaid credit and stops at $0' : 'monthly by invoice, with no hard stop'}`,
      }));
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Monetization config update failed. The previous billing type is still enforced.',
        finance: 'Could not change how this user is billed. Nothing changed.',
      }));
    } finally {
      setConfigSaving(false);
    }
  };

  // Subscribe Product
  const handleSubscribeProduct = async (productName: string) => {
    if (blockRoleWrite('rate_plans')) return;
    setSubscribingProduct(productName);
    setError(null);
    try {
      await subscribeDeveloper(productName, selectedDeveloper);
      await loadPlansAndSubscriptions(selectedDeveloper);
      setSuccessMessage(sp({
        technical: `Subscribed ${selectedDeveloper} to ${productName}. Its rate plan now meters this developer's calls on that product.`,
        finance: `${selectedDeveloper} is now enrolled in ${personaByProduct(productName)} and billed on its plan`,
      }));
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'Subscription create failed. The developer is not metered on this rate plan.',
        finance: 'Could not enrol this user. They are not billed on this plan.',
      }));
    } finally {
      setSubscribingProduct(null);
    }
  };

  // KVM Rates Management
  const hasRateChanges = useMemo(() => {
    return JSON.stringify(rates) !== JSON.stringify(initialRates);
  }, [rates, initialRates]);

  const handleSaveKvmRates = async () => {
    if (blockRoleWrite('pricing')) return;
    if (blockProdWrite()) return;
    setRatesSaving(true);
    setError(null);
    try {
      await updateModelRates(env, rates);
      setInitialRates(JSON.parse(JSON.stringify(rates)));
      setSuccessMessage(sp({
        technical: 'Wrote the Dev rate-card KVM. Dev proxies meter new calls at these rates; Prod rates change only via PR.',
        finance: 'Saved model prices in the Sandbox. Live charges change only after approval.',
      }));
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err: any) {
      setError(err.message || sp({
        technical: 'KVM write failed. Proxies keep metering with the previous rates.',
        finance: 'Could not save model prices. The previous prices still apply.',
      }));
    } finally {
      setRatesSaving(false);
    }
  };

  const handleRateChange = (modelId: string, field: 'input' | 'output', value: string) => {
    if (blockRoleWrite('pricing')) return;
    const num = parseFloat(value);
    setRates((prev) => ({
      ...prev,
      [modelId]: {
        ...prev[modelId],
        [field]: isNaN(num) ? 0 : num,
      },
    }));
  };

  const handleTierChange = (modelId: string, tier: string) => {
    if (blockRoleWrite('pricing')) return;
    setRates((prev) => ({
      ...prev,
      [modelId]: {
        ...prev[modelId],
        tier,
      },
    }));
  };

  const handleDeleteModel = (modelId: string) => {
    if (blockRoleWrite('pricing')) return;
    if (modelId === 'default') {
      alert(sp({
        technical: 'The "default" entry cannot be deleted: metering falls back to it for any model without its own rate, so removing it would leave those calls unpriced.',
        finance: 'The "default" price is charged for any model not listed, so it cannot be deleted.',
      }));
      return;
    }
    if (confirm(sp({
      technical: `Remove the "${modelId}" rate? After saving, calls to it are metered at the "default" rate.`,
      finance: `Remove the price for "${modelId}"? It will then be charged at the "default" price.`,
    }))) {
      setRates((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

  const handleAddModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (blockRoleWrite('pricing')) return;
    const cleanId = newModelId.trim().toLowerCase();
    if (!cleanId) return;

    setRates((prev) => ({
      ...prev,
      [cleanId]: {
        input: parseFloat(newInputRate) || 0,
        output: parseFloat(newOutputRate) || 0,
        provider: newProvider,
        tier: newTier,
      },
    }));

    setShowAddModal(false);
    setNewModelId('');
    setNewInputRate('0.15');
    setNewOutputRate('0.60');
  };

  // Filtered Model Rates
  const filteredModels = useMemo(() => {
    return Object.entries(rates).filter(([id, data]) => {
      const matchesSearch = id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesProvider =
        filterProvider === 'all' ||
        (data.provider && data.provider.toLowerCase() === filterProvider.toLowerCase());
      return matchesSearch && matchesProvider;
    });
  }, [rates, searchQuery, filterProvider]);

  // Live Calculator Calculation
  const calculatedCost = useMemo(() => {
    const modelData = rates[calcModel] || rates['default'] || { input: 0.15, output: 0.60 };
    const inCost = (calcPromptTokens / 1_000_000) * modelData.input;
    const outCost = (calcOutputTokens / 1_000_000) * modelData.output;
    const total = inCost + outCost;
    const micros = Math.max(1, Math.round(total * 1_000_000));
    return { inCost, outCost, total, micros };
  }, [rates, calcModel, calcPromptTokens, calcOutputTokens]);

  const rawWalletAmountExact = useMemo(() => {
    const units = walletBalance.units || '0';
    const nanos = walletBalance.nanos || 0;
    const fractional = ((Number(nanos) || 0) / 1_000_000_000).toFixed(6).slice(2);
    return `${units}.${fractional}`;
  }, [walletBalance]);

  const displayWalletAmount = useMemo(() => {
    if (isSimulatingExhaustedWallet) return '0.00';
    const units = walletBalance.units || '0';
    const nanos = walletBalance.nanos || 0;
    const total = Number(units) + (Number(nanos) || 0) / 1_000_000_000;
    return total.toFixed(2);
  }, [walletBalance, isSimulatingExhaustedWallet]);

  const userAttributions: UserMonetizationAttribution[] = useMemo(() => {
    const ssoBalanceNum = Number(walletBalance.units || '0') + Number(walletBalance.nanos || 0) / 1e9;

    let list: UserMonetizationAttribution[] = [];

    if (liveAttributions.length > 0) {
      // walletBalance is loaded for selectedDeveloper only, so it must only overwrite that
      // developer's row. Also matching defaultEmail painted the selected developer's balance
      // onto the SSO caller whenever a different developer was picked.
      list = liveAttributions.map((a) => {
        if (a.userEmail.toLowerCase() === selectedDeveloper.toLowerCase()) {
          return {
            ...a,
            currentBalanceUsd: isSimulatingExhaustedWallet ? 0.00 : ssoBalanceNum,
          };
        }
        return a;
      });
    } else {
      list = [
        {
          userEmail: defaultEmail,
          name: `Current SSO User (${defaultEmail.split('@')[0]})`,
          tier: PERSONAS[0].label,
          badge: 'Prepaid Wallet',
          billingType: 'PREPAID',
          totalConsumedUsd: 0,
          totalCalls: 0,
          totalTokens: 0,
          currentBalanceUsd: isSimulatingExhaustedWallet ? 0.00 : ssoBalanceNum,
          allocatedBudgetUsd: 150.00,
          lastActive: 'Active Wallet',
        },
      ];
    }

    if (!userAttributionSearch.trim()) return list;
    const q = userAttributionSearch.toLowerCase();
    return list.filter(
      (u) =>
        u.userEmail.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.badge.toLowerCase().includes(q)
    );
  }, [liveAttributions, selectedDeveloper, defaultEmail, walletBalance, isSimulatingExhaustedWallet, userAttributionSearch]);

  // Enterprise User & Persona Attribution Table Sorting (rules live in utils/monetizationSort)
  const [attributionSortColumn, setAttributionSortColumn] = useState<AttributionSortColumn>('name');
  const [attributionSortDirection, setAttributionSortDirection] = useState<SortDirection>('asc');

  const handleAttributionSort = (col: AttributionSortColumn) => {
    if (attributionSortColumn === col) {
      setAttributionSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setAttributionSortColumn(col);
      setAttributionSortDirection(defaultAttributionSortDirection(col));
    }
  };

  const sortedUserAttributions = useMemo(
    () => sortAttributionTable(userAttributions, attributionSortColumn, attributionSortDirection),
    [userAttributions, attributionSortColumn, attributionSortDirection]
  );

  return (
    <div className="h-full flex flex-col bg-slate-50 text-slate-900 overflow-y-auto">
      {/* Admin Console Header: section tabs (environment controls sit on the status line below) */}
      <div className="border-b border-slate-200 bg-white/95 px-4 sm:px-6 py-2.5 backdrop-blur">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5">
          {/* Section Navigation Strip: Sleek Segmented Control (wraps instead of clipping) */}
          <div className="flex items-center min-w-0">
            <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shadow-2xs">
              {roleCanSeeTab(adminRole, 'products') && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('products')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                    activeSubTab === 'products'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Box className="w-3.5 h-3.5 text-blue-600" />
                  <span>{s('AI Products', 'Personas')}</span>
                  {hasProductChanges && (
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
                  )}
                </button>
              )}

              {roleCanSeeTab(adminRole, 'wallets') && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('wallets')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                    activeSubTab === 'wallets'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{s('Wallets & Credits', 'Prepaid credit')}</span>
                </button>
              )}

              {roleCanSeeTab(adminRole, 'rate-cards') && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('rate-cards')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                    activeSubTab === 'rate-cards'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Coins className="w-3.5 h-3.5 text-amber-600" />
                  <span>{s('Rate Cards', 'Model prices')}</span>
                  {hasRateChanges && (
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                  )}
                </button>
              )}

              {roleCanSeeTab(adminRole, 'rate-plans') && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('rate-plans')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                    activeSubTab === 'rate-plans'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-purple-600" />
                  <span>{s('Rate Plans', 'Billing plans')}</span>
                </button>
              )}

              {roleCanSeeTab(adminRole, 'policies') && (
                <button
                  type="button"
                  onClick={() => setActiveSubTab('policies')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer shrink-0 ${
                    activeSubTab === 'policies'
                      ? 'bg-white text-slate-900 shadow-2xs border border-slate-200/80'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-rose-600" />
                  <span>{s('Guardrails', 'Safety controls')}</span>
                </button>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 w-full space-y-3.5 flex-1">
        {/* Environment status + Dev/Prod controls on one line (tabs stay in the header row above) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[200px]">
            {(activeSubTab === 'products' || activeSubTab === 'rate-cards') && (
              <div
                className={`px-3 py-1.5 rounded-xl border text-[11px] flex items-center gap-2 ${
                  isProdView ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}
                title={!isProdView && voice === 'technical' && products[0]?.apigeeName
                  ? `Dev products: ${products.map((p) => p.apigeeName).join(', ')}`
                  : undefined}
              >
                {isProdView ? <Lock className="w-3.5 h-3.5 shrink-0" /> : <GitPullRequest className="w-3.5 h-3.5 shrink-0" />}
                {isProdView ? sp({
                  technical: <span><strong>Production · read-only.</strong> What Prod proxies enforce now. Writes are refused here and by the server; promote a Dev change with a PR.</span>,
                  finance: <span><strong>Live · view only.</strong> The budgets and prices users are charged today. Changes need an approved change request.</span>,
                  ai_coe: <span><strong>Live · view only.</strong> The models and routing teams use today. Changes need an approved change request.</span>,
                }) : sp({
                  technical: <span><strong>Dev sandbox.</strong> Saves hit the Dev products and dev rate-card KVM only (Ask Apigee writes here too). Prod is unaffected until a PR merges.</span>,
                  finance: <span><strong>Sandbox.</strong> Try budget and price changes here; nobody is charged differently until they are approved for Live.</span>,
                  ai_coe: <span><strong>Sandbox.</strong> Try model and routing changes here; teams keep today's setup until it is approved for Live.</span>,
                })}
              </div>
            )}
            {/* Wallets tab: no room beside the user/credit chips, so the org-wide note is the chip tooltip */}
            {activeSubTab === 'rate-plans' && (
              <div className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-[11px] text-slate-500">
                {sp({
                  technical: 'Rate plans and subscriptions are org-level, not per env: a change here hits Dev and Prod at once.',
                  finance: 'Billing plans apply company-wide: the same in Sandbox and Live, so changes bill everyone.',
                })}
              </div>
            )}
          </div>
            {/* Quick Header Actions: Developer Selector, Active Wallet Chip & Refresh (kept on one line) */}
            <div className="flex items-center gap-2 flex-nowrap shrink-0 ml-auto">
              {/* Developer account context is only meaningful on the wallets sub-tab */}
              {activeSubTab === 'wallets' && (
                <>
                  {/* Developer Selector */}
                  <div className="flex items-center gap-1.5 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 text-xs shadow-2xs">
                    <User className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                    <span className="text-slate-500 text-[11px] font-semibold">{s('Dev:', 'User:')}</span>
                    <select
                      value={selectedDeveloper}
                      onChange={(e) => setSelectedDeveloper(e.target.value)}
                      className="bg-transparent text-slate-800 font-sans text-xs focus:outline-none cursor-pointer max-w-[210px] truncate font-medium"
                      title={sp({ technical: 'Developer whose wallet and billing config you are reading and writing', finance: 'Pick a user to see and top up their prepaid credit' })}
                    >
                      {availableDevelopers.map((d) => (
                        <option key={d.email} value={d.email} className="bg-white text-slate-900 font-sans">
                          {d.name ? `${d.name} (${d.email})` : d.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Live Wallet Chip */}
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs shadow-2xs"
                    title={`Exact balance: $${rawWalletAmountExact} USD. ${sp({ technical: 'Wallets are org-level: a top-up here applies to Dev and Prod traffic.', finance: 'Credit is company-wide: the same balance in Sandbox and Live.' })}`}
                  >
                    <Wallet className="w-3.5 h-3.5 text-emerald-600" />
                    <span className="text-slate-500 text-[11px] font-semibold">{s('Wallet:', 'Credit:')}</span>
                    <span className={`font-mono font-bold ${isSimulatingExhaustedWallet ? 'text-rose-600 line-through' : 'text-emerald-600'}`}>
                      ${displayWalletAmount} <span className="text-[10px] font-normal text-slate-500 font-sans">USD</span>
                    </span>
                    {isSimulatingExhaustedWallet && (
                      <span className="text-[9px] bg-rose-50 text-rose-700 px-1 py-0.2 rounded border border-rose-200 font-semibold">
                        {sp({ technical: '403', finance: 'Blocked' })}
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* Environment: Dev (editable sandbox) / Prod (read-only) */}
              <div
                className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs shadow-2xs"
                role="group"
                aria-label="Admin Console environment"
              >
                {(['dev', 'prod'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEnv(e)}
                    aria-pressed={env === e}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                      env === e
                        ? e === 'prod'
                          ? 'bg-slate-700 text-white shadow-2xs' // not slate-900: the light theme remaps it to white
                          : 'bg-emerald-600 text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                    title={e === 'prod'
                      ? sp({ technical: 'Prod: what live proxies enforce. Read-only; changes land via PR.', finance: 'Live: what users are charged today (view only)', ai_coe: 'Live: the models teams use today (view only)' })
                      : sp({ technical: 'Dev: editable sandbox Ask Apigee also writes to. No Prod impact.', finance: 'Sandbox: try budget and price changes safely (Ask Apigee works here too)', ai_coe: 'Sandbox: try model and routing changes safely (Ask Apigee works here too)' })}
                  >
                    {e === 'prod' && <Lock className="w-3 h-3" />}
                    {e === 'dev' ? devLabel : prodLabel}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowCompare(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white hover:bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold transition cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
                title={sp({ technical: 'Diff Dev against Prod: the change set a PR would promote', finance: 'See which budgets and prices the Sandbox would change in Live', ai_coe: 'See which models and routing the Sandbox would change in Live' })}
              >
                <GitCompare className="w-3.5 h-3.5" />
                <span>Compare {devLabel} ↔ {prodLabel}</span>
              </button>

              {/* Quick Refresh */}
              <button
                type="button"
                onClick={() => handleRefreshAll(true)}
                disabled={walletLoading || ratesLoading || plansLoading || productsLoading}
                className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer shadow-2xs disabled:opacity-50 shrink-0"
                title={sp({ technical: 'Re-read products, KVM, wallets and plans from the Management API', finance: 'Reload budgets, credit, prices and plans', ai_coe: 'Reload models, routing and safety settings' })}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${walletLoading || ratesLoading || plansLoading || productsLoading ? 'animate-spin text-emerald-500' : 'text-slate-500'}`} />
              </button>
            </div>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center justify-between animate-in fade-in duration-150">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-500 hover:text-emerald-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* SUB-TAB 0: AI PRODUCTS & ENTITLEMENTS */}
        {activeSubTab === 'products' && (
          <div className="space-y-3">
            {/* Unified Command Bar: Tiers, Apigee Metadata & Actions */}
            <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 shadow-2xs flex flex-wrap items-center justify-between gap-2.5">
              {/* Left: Persona product switcher (one API product per persona) */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80">
                {PERSONAS.map(displayPersona).map((persona, personaIdx) => {
                  const tierName = persona.product;
                  const isSelected = selectedProductName === tierName;
                  const prod = editedProducts[tierName] || products.find((p) => p.name === tierName);
                  const orig = products.find((p) => p.name === tierName);
                  const isDirty = prod && orig && JSON.stringify(prod) !== JSON.stringify(orig);
                  const modelCount = prod?.llmOperationGroup?.operationConfigs?.length || 0;

                  return (
                    <button
                      key={tierName}
                      type="button"
                      onClick={() => setSelectedProductName(tierName)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition cursor-pointer ${
                        isSelected
                          ? ['bg-purple-600', 'bg-blue-600', 'bg-emerald-600'][personaIdx] + ' text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                      title={sp({
                        technical: `${persona.label}: API product "${tierName}". Keys on this product are held to its models, quotas and budget.`,
                        finance: `${persona.label}: ${persona.summary}. See and set this team's monthly budget.`,
                        ai_coe: `${persona.label}: ${persona.summary}. Choose this team's models and routing.`,
                      })}
                    >
                      {personaIdx === 0 ? <Sparkles className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5" />}
                      <span className="whitespace-nowrap">{persona.label}</span>
                      <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-normal ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {modelCount} models
                      </span>
                      {isDirty && (
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" title={sp({ technical: 'Unsaved: not yet written to Dev', business: 'Unsaved changes' })} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {roleCan(adminRole, 'reset') && (
                  <button
                    type="button"
                    onClick={() => { if (!blockRoleWrite('reset') && !blockProdWrite()) setShowProductResetModal(true); }}
                    disabled={productResetting || productsLoading}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-xs font-semibold transition cursor-pointer shadow-2xs disabled:opacity-50"
                    title={isProdView
                      ? sp({ technical: 'Prod is read-only', business: 'Live is view only' })
                      : sp({ technical: 'Re-clone Prod into the Dev products. Discards every unmerged Dev edit.', business: 'Copy the live setup into the Sandbox and start over' })}
                  >
                    <RotateCcw className={`w-3 h-3 ${productResetting ? 'animate-spin' : ''}`} />
                    <span>{productResetting ? 'Resetting...' : `Reset ${devLabel} to ${prodLabel}`}</span>
                  </button>
                )}

                {hasProductChanges && (
                  <button
                    type="button"
                    onClick={handleRevertProduct}
                    disabled={productSaving}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition cursor-pointer"
                  >
                    <span>{s('Revert', 'Undo')}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveProduct}
                  disabled={!hasProductChanges || productSaving || productsLoading}
                  className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer ${
                    hasProductChanges && !productSaving
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  }`}
                  title={isProdView
                    ? sp({ technical: 'Prod is read-only: save in Dev, then promote with a PR', finance: 'Live is view only: budget changes need an approved change request', ai_coe: 'Live is view only: model changes need an approved change request' })
                    : sp({ technical: 'Write this product to Dev. Dev proxies enforce it on the next call.', finance: 'Save this budget in the Sandbox', ai_coe: 'Save these models and routing in the Sandbox' })}
                >
                  {isProdView ? <Lock className="w-3 h-3" /> : <Save className={`w-3 h-3 ${productSaving ? 'animate-spin' : ''}`} />}
                  <span>{productSaving ? 'Saving...' : isProdView ? s('Save (read-only)', 'Save (view only)') : `Save to ${devLabel}`}</span>
                </button>
              </div>
            </div>

            {/* Product Configuration Categories Navigation */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {/* Tab 1: Whitelisted Models & Rate Limits */}
              {roleCanSeeSection(adminRole, 'models') && (
                <button
                  type="button"
                  onClick={() => setProductConfigSection('models')}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    productConfigSection === 'models'
                      ? 'bg-blue-50/90 border-blue-500 text-blue-950 ring-2 ring-blue-500/20 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${productConfigSection === 'models' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-blue-100 text-blue-700'}`}>
                      <Cpu className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                      productConfigSection === 'models' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}>
                      {configuredModels.length} {configuredModels.length === 1 ? 'model' : 'models'}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 leading-snug">{byRole('Allowed Models & Quotas', 'Models & usage limits', 'Model access per team')}</div>
                  <div className="text-[10px] text-slate-500 leading-tight mt-0.5 truncate">{sp({ technical: 'Allow-list + token quotas (429)', ai_coe: 'Who gets which model, fairly' })}</div>
                </button>
              )}

              {/* Tab 2: Prompt Auto-Routing Targets */}
              {roleCanSeeSection(adminRole, 'routing') && (
                <button
                  type="button"
                  onClick={() => setProductConfigSection('routing')}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    productConfigSection === 'routing'
                      ? 'bg-purple-50/90 border-purple-500 text-purple-950 ring-2 ring-purple-500/20 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${productConfigSection === 'routing' ? 'bg-purple-600 text-white shadow-2xs' : 'bg-purple-100 text-purple-700'}`}>
                      <Route className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                      productConfigSection === 'routing' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}>
                      {s('4 targets', '4 task types')}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 leading-snug">{sp({ technical: 'Smart Routing Model Mapping', ai_coe: 'Automatic model choice' })}</div>
                  <div className="text-[10px] text-slate-500 leading-tight mt-0.5 truncate">{sp({ technical: 'routing.model.* for /auto calls', ai_coe: 'Right-size the model per task' })}</div>
                </button>
              )}

              {/* Tab 3: Developer Budget Governance */}
              {roleCanSeeSection(adminRole, 'budget') && (
                <button
                  type="button"
                  onClick={() => setProductConfigSection('budget')}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    productConfigSection === 'budget'
                      ? 'bg-emerald-50/90 border-emerald-500 text-emerald-950 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${productConfigSection === 'budget' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-emerald-100 text-emerald-700'}`}>
                      <Coins className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                      productConfigSection === 'budget' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}>
                      ${budgetUsd}/mo
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 leading-snug">{byRole('Budget Governance', 'Spend control per user', 'Budget per user')}</div>
                  <div className="text-[10px] text-slate-500 leading-tight mt-0.5 truncate">{sp({ technical: 'Monthly cap per key, then blocked', finance: 'Monthly cap on each user\'s spend' })}</div>
                </button>
              )}

              {/* Tab 4: Custom Attributes */}
              {roleCanSeeSection(adminRole, 'custom') && (
                <button
                  type="button"
                  onClick={() => setProductConfigSection('custom')}
                  className={`p-2.5 rounded-xl border text-left transition cursor-pointer flex flex-col justify-between ${
                    productConfigSection === 'custom'
                      ? 'bg-amber-50/90 border-amber-500 text-amber-950 ring-2 ring-amber-500/20 shadow-xs'
                      : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1 mb-1.5">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${productConfigSection === 'custom' ? 'bg-amber-600 text-white shadow-2xs' : 'bg-amber-100 text-amber-700'}`}>
                      <Tag className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold ${
                      productConfigSection === 'custom' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200/80'
                    }`}>
                      {customAttributesList.length} {customAttributesList.length === 1 ? s('attr', 'label') : s('attrs', 'labels')}
                    </span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 leading-snug">{s('Custom Attributes', 'Other settings')}</div>
                  <div className="text-[10px] text-slate-500 leading-tight mt-0.5 truncate">{sp({ technical: 'Product attrs read by proxy flows', business: 'Extra labels on this persona' })}</div>
                </button>
              )}
            </div>

            {/* CARD 1: Whitelisted Models & Token Rate Quotas */}
            {productConfigSection === 'models' && (
              <RoleGate role={adminRole} capability="models" onSwitchRole={onAdminRoleChange}>
              <div className="bg-white rounded-xl border-2 border-blue-200/90 shadow-xs overflow-hidden">
                <div className="bg-slate-50/90 px-4 py-2.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Cpu className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-slate-900">
                          {sp({ technical: 'Allowed Models & Rate Limits (Token Quotas)', ai_coe: 'Which AI models this team can use, and how much' })}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {sp({
                          technical: 'Enforced per key by the LLM token-quota policy: calls to unlisted models are rejected, and a model over its token quota returns 429 until the window resets. Applies to every key on this product.',
                          ai_coe: 'Only the models listed here are open to this team; anything else is refused. Each model gets a fair-use limit so one team cannot use up shared capacity.',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-blue-800 bg-white border border-blue-200 px-2.5 py-1 rounded-lg shrink-0 shadow-2xs self-start sm:self-auto">
                    {configuredModels.length} {sp({ technical: 'allow-listed', ai_coe: 'models allowed' })}
                  </div>
                </div>

                <div className="p-3.5 space-y-2.5">
                  {/* Models List */}
                  <div className="space-y-2">
                    {configuredModels.map((m) => {
                      const isHaiku = m.model === 'claude-haiku-4-5@20251001';
                      const isAuto = m.model === 'auto';
                      const isLowLimit = parseInt(m.limit, 10) <= 100;

                      return (
                        <div
                          key={m.model}
                          className={`p-2.5 rounded-xl border transition flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isHaiku && isLowLimit
                              ? 'bg-amber-50/60 border-amber-200'
                              : 'bg-slate-50/80 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-[240px]">
                            <ModelProviderIcon model={m.model} />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-bold text-slate-900">{m.model}</span>
                                {isAuto && (
                                  <span className="text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-0.2 rounded-full border border-purple-200">
                                    {sp({ technical: 'Auto-Routed', ai_coe: 'Automatic' })}
                                  </span>
                                )}
                                {isHaiku && isLowLimit && (
                                  <span className="text-[10px] font-semibold bg-rose-100 text-rose-700 px-1.5 py-0.2 rounded-full border border-rose-200">
                                    {sp({ technical: '429 Trigger (low tpm)', ai_coe: 'Low limit: blocks quickly' })}
                                  </span>
                                )}
                              </div>
                              {voice === 'technical' && (
                                <div className="text-[10px] text-slate-400 font-mono">
                                  Resource: {m.resource}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Quota inputs and preset pills */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded-lg border border-slate-200 shadow-2xs">
                              <span className="text-[11px] font-semibold text-slate-500">{sp({ technical: 'Quota:', ai_coe: 'Limit:' })}</span>
                              <input
                                type="number"
                                min="1"
                                value={m.limit}
                                onChange={(e) => handleUpdateModelQuota(m.model, 'limit', e.target.value)}
                                className="w-16 font-mono text-xs font-bold text-slate-900 text-right bg-slate-50 rounded px-1 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <span className="text-[10px] text-slate-400">tokens /</span>
                              <input
                                type="number"
                                min="1"
                                value={m.interval}
                                onChange={(e) => handleUpdateModelQuota(m.model, 'interval', e.target.value)}
                                className="w-10 font-mono text-xs font-bold text-slate-900 text-center bg-slate-50 rounded px-1 py-0.5 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                              <select
                                value={m.timeUnit}
                                onChange={(e) => handleUpdateModelQuota(m.model, 'timeUnit', e.target.value)}
                                className="text-xs font-mono text-slate-700 bg-transparent focus:outline-none cursor-pointer"
                              >
                                <option value="minute">minute</option>
                                <option value="hour">hour</option>
                                <option value="day">day</option>
                                <option value="week">week</option>
                                <option value="month">month</option>
                              </select>
                            </div>

                            {/* Quick Presets */}
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdateModelQuota(m.model, 'limit', '300')}
                                className={`px-1.5 py-1 rounded-md text-[10px] font-mono font-medium transition cursor-pointer border ${
                                  m.limit === '300'
                                    ? 'bg-rose-50 text-rose-700 border-rose-300 font-bold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                                title={sp({
                                  technical: '300 tokens/min per key: quota alert fires past 50%, the 4th ~120-token call gets 429 until the minute resets',
                                  ai_coe: '300 tokens a minute: the team is warned past half and blocked on the 4th short question (good for a fair-use demo)',
                                })}
                              >
                                300 tpm
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateModelQuota(m.model, 'limit', '2000')}
                                className={`px-1.5 py-1 rounded-md text-[10px] font-mono font-medium transition cursor-pointer border ${
                                  m.limit === '2000'
                                    ? 'bg-blue-50 text-blue-700 border-blue-300 font-bold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                                title={sp({
                                  technical: '2,000 tokens/min per key (Support & Sales default): enough for chat, 429 on bursts',
                                  ai_coe: '2,000 tokens a minute (Support & Sales default): plenty for short customer replies',
                                })}
                              >
                                2k
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateModelQuota(m.model, 'limit', '50000')}
                                className={`px-1.5 py-1 rounded-md text-[10px] font-mono font-medium transition cursor-pointer border ${
                                  m.limit === '50000'
                                    ? 'bg-purple-50 text-purple-700 border-purple-300 font-bold'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                                }`}
                                title={sp({
                                  technical: '50,000 tokens/min per key: effectively no throttling for normal use',
                                  ai_coe: '50,000 tokens a minute: room for heavy use such as coding or long documents',
                                })}
                              >
                                50k
                              </button>
                            </div>

                            {/* Remove Button */}
                            {!isAuto && (
                              <button
                                type="button"
                                onClick={() => handleRemoveModel(m.model)}
                                className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                                title={sp({
                                  technical: `Drop ${m.model} from this product. After save, keys here are rejected for it.`,
                                  ai_coe: `Stop this team using ${m.model}`,
                                })}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add Models Controls */}
                  <div className="pt-3 border-t border-slate-100 space-y-2">
                    <span className="text-xs font-semibold text-slate-700">{sp({ technical: 'Quick-Add Catalog Models:', ai_coe: 'Give this team another model:' })}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {CATALOG_MODELS.filter((cat) => !configuredModels.some((m) => m.model === cat.id)).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleAddProductModel(cat.id, selectedProductName === PERSONAS[0].product ? { limit: '50000', interval: '1', timeUnit: 'minute' } : { limit: '2000', interval: '1', timeUnit: 'minute' })}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 text-xs text-slate-700 transition cursor-pointer shadow-2xs"
                          title={sp({
                            technical: `${cat.desc}. Adds an operation with a ${selectedProductName === PERSONAS[0].product ? '50k' : '2k'} tpm quota.`,
                            ai_coe: `${cat.desc}. Starts with a ${selectedProductName === PERSONAS[0].product ? '50,000' : '2,000'} tokens-a-minute limit.`,
                          })}
                        >
                          {cat.provider === 'google' ? <GoogleLogo className="w-3.5 h-3.5 shrink-0" /> : <AnthropicLogo className="w-3.5 h-3.5 shrink-0" />}
                          <span className="font-semibold">{cat.name}</span>
                          <Plus className="w-3 h-3 ml-0.5 text-slate-400" />
                        </button>
                      ))}
                    </div>

                    {/* Custom Model Input */}
                    <div className="flex items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={customModelInput}
                        onChange={(e) => setCustomModelInput(e.target.value)}
                        placeholder={sp({
                          technical: 'Model ID as the backend expects it (e.g. meta/llama-3.3-70b or mistral-large)...',
                          ai_coe: 'Another model to allow (e.g. meta/llama-3.3-70b or mistral-large)...',
                        })}
                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleAddProductModel(customModelInput)}
                        disabled={!customModelInput.trim()}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50 shadow-xs"
                      >
                        <Plus className="w-3 h-3" />
                        <span>{sp({ technical: 'Add Model', ai_coe: 'Allow model' })}</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              </RoleGate>
            )}

            {/* CARD 2: Prompt Auto-Routing Targets */}
            {productConfigSection === 'routing' && (
              <RoleGate role={adminRole} capability="routing" onSwitchRole={onAdminRoleChange}>
              <div className="bg-white rounded-xl border-2 border-purple-200/90 shadow-xs overflow-hidden">
                <div className="bg-purple-50/50 px-4 py-2.5 border-b border-purple-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Route className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-slate-900">
                          {sp({ technical: 'Smart Routing Model Mappings', ai_coe: 'Automatic model choice' })}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {sp<React.ReactNode>({
                          technical: <>Calls to <code className="font-mono text-purple-700 font-semibold">auto</code> are classified by the semantic router and rewritten to the <code className="font-mono text-purple-700">routing.model.*</code> target below. A target must also be allow-listed, or the call is rejected; a change here re-routes every auto call on this product.</>,
                          finance: 'When someone picks Auto, the gateway sends each question to the model set for that kind of task. Cheaper models for simple tasks keep costs down.',
                          ai_coe: 'When someone picks Auto, the gateway reads the question and sends it to the model you pick for that kind of task. Put your strongest model on hard reasoning and a fast, cheap one on quick lookups.',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-purple-800 bg-white border border-purple-200 px-2.5 py-1 rounded-lg shrink-0 shadow-2xs self-start sm:self-auto">
                    {sp({ technical: '4 routing targets', ai_coe: '4 task types' })}
                  </div>
                </div>

                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[
                      {
                        key: 'routing.model.coding',
                        label: 'Coding & Development',
                        desc: sp({ technical: 'Router class "coding": code generation, debugging, refactoring, syntax.', ai_coe: 'Writing, fixing and explaining code. Worth a strong coding model.' }),
                        icon: Code2,
                        iconColor: 'text-blue-600 bg-blue-50 border-blue-200',
                      },
                      {
                        key: 'routing.model.deep_reasoning',
                        label: 'Complex Reasoning & Math',
                        desc: sp({ technical: 'Router class "deep_reasoning": multi-step logic, planning, math. Usually the costliest target.', ai_coe: 'Multi-step logic, planning and maths. Where your most capable model pays off.' }),
                        icon: Brain,
                        iconColor: 'text-purple-600 bg-purple-50 border-purple-200',
                      },
                      {
                        key: 'routing.model.simple',
                        label: 'Quick Lookups & Facts',
                        desc: sp({ technical: 'Router class "simple": short factual lookups. Point at a low-latency model.', ai_coe: 'Short factual questions. A fast, low-cost model is enough.' }),
                        icon: Zap,
                        iconColor: 'text-amber-600 bg-amber-50 border-amber-200',
                      },
                      {
                        key: 'routing.model.general',
                        label: 'General Tasks & Dialogue',
                        desc: sp({ technical: 'Router class "general": catch-all when no other class matches.', ai_coe: 'Everything else: drafting, general help and conversation.' }),
                        icon: MessageSquare,
                        iconColor: 'text-emerald-600 bg-emerald-50 border-emerald-200',
                      },
                    ].map(({ key, label, desc, icon: IconComponent, iconColor }) => {
                      const currentTarget = getProductAttr(key);
                      return (
                        <div key={key} className="bg-slate-50/80 rounded-xl border border-slate-200 p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <div className={`w-6 h-6 rounded-md flex items-center justify-center border ${iconColor}`}>
                                <IconComponent className="w-3 h-3" />
                              </div>
                              <span className="text-xs font-bold text-slate-900">{label}</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
                          <div className="pt-0.5">
                            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-2xs focus-within:ring-1 focus-within:ring-purple-500">
                              <span className="text-[11px] font-semibold text-slate-400">{sp({ technical: 'Target:', ai_coe: 'Model used:' })}</span>
                              <select
                                value={currentTarget}
                                onChange={(e) => setProductAttr(key, e.target.value)}
                                className="flex-1 bg-transparent text-xs font-mono font-bold text-slate-900 focus:outline-none cursor-pointer"
                              >
                                {configuredModels.filter((m) => m.model !== 'auto').map((m) => (
                                  <option key={m.model} value={m.model}>
                                    {m.model}
                                  </option>
                                ))}
                                {currentTarget && !configuredModels.some((m) => m.model === currentTarget) && (
                                  <option value={currentTarget}>{currentTarget}</option>
                                )}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              </RoleGate>
            )}

            {/* CARD 3: Developer Monthly Budget Cap */}
            {productConfigSection === 'budget' && (
              <RoleGate role={adminRole} capability="budget" onSwitchRole={onAdminRoleChange}>
              <div className="bg-white rounded-xl border-2 border-emerald-200/90 shadow-xs overflow-hidden">
                <div className="bg-emerald-50/50 px-4 py-2.5 border-b border-emerald-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Coins className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-slate-900">
                          {byRole('Developer Budget Governance', 'Spend control per user', 'Budget per user')}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {sp({
                          technical: 'developer.budget.* on the product: the proxy meters each call against the rate card and refuses further calls once a developer passes the cap, until the period resets.',
                          finance: 'The most each user on this persona can spend in the period. Once they reach it their requests are stopped, so spend never runs past the cap.',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-emerald-800 bg-white border border-emerald-200 px-2.5 py-1 rounded-lg shrink-0 shadow-2xs self-start sm:self-auto">
                    ${budgetUsd} USD {sp({ technical: 'cap', finance: 'per user' })}
                  </div>
                </div>

                <div className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                    <div>
                      <div className="text-xs font-bold text-slate-900">{sp({ technical: 'Periodic Spending Ceiling', finance: 'Spending limit' })}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {sp({
                          technical: 'Shipped defaults: Engineering & IT $20.00 • Analysts $10.00 • Support & Sales $5.00 per month (per developer)',
                          finance: 'Standard budgets: Engineering & IT $20.00 • Analysts $10.00 • Support & Sales $5.00 per user a month',
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-2xs">
                        <span className="text-slate-400 font-mono text-xs mr-1">$</span>
                        <input
                          type="number"
                          step="0.50"
                          min="0"
                          value={budgetUsd}
                          onChange={(e) => handleBudgetUsdChange(e.target.value)}
                          className="w-16 text-xs font-mono font-bold text-slate-900 focus:outline-none"
                        />
                        <span className="text-[10px] text-slate-400 font-sans ml-1">USD</span>
                      </div>

                      <span className="text-xs text-slate-400">per</span>
                      <input
                        type="number"
                        min="1"
                        value={getProductAttr('developer.budget.interval') || '1'}
                        onChange={(e) => setProductAttr('developer.budget.interval', e.target.value)}
                        className="w-10 bg-white border border-slate-300 rounded-lg px-1.5 py-1 text-xs font-mono font-bold text-slate-900 text-center shadow-2xs focus:outline-none"
                      />

                      <select
                        value={getProductAttr('developer.budget.timeunit') || 'month'}
                        onChange={(e) => setProductAttr('developer.budget.timeunit', e.target.value)}
                        className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs font-mono text-slate-700 shadow-2xs focus:outline-none cursor-pointer"
                      >
                        <option value="minute">minute</option>
                        <option value="hour">hour</option>
                        <option value="day">day</option>
                        <option value="week">week</option>
                        <option value="month">month</option>
                        <option value="year">year</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
              </RoleGate>
            )}

            {/* CARD 4: Other Custom Attributes */}
            {productConfigSection === 'custom' && (
              <RoleGate role={adminRole} capability="custom" onSwitchRole={onAdminRoleChange}>
              <div className="bg-white rounded-xl border-2 border-amber-200/90 shadow-xs overflow-hidden">
                <div className="bg-amber-50/50 px-4 py-2.5 border-b border-amber-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Tag className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-xs font-bold text-slate-900">
                          {s('Other Custom Attributes', 'Other settings')}
                        </h3>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {sp({
                          technical: 'Free-form product attributes, readable by proxy flows as verifyapikey.*.apiproduct.<name>. Anything that reads them (policies, reports) sees a change as soon as it is saved, so check consumers first.',
                          business: 'Extra labels stored on this persona, used by other systems and reports.',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-[11px] font-mono font-semibold text-amber-800 bg-white border border-amber-200 px-2.5 py-1 rounded-lg shrink-0 shadow-2xs self-start sm:self-auto">
                    {customAttributesList.length} {sp({ technical: 'custom attributes', business: 'labels' })}
                  </div>
                </div>

                <div className="p-4 space-y-2.5">
                  {customAttributesList.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-2">
                      {sp({ technical: 'No custom attributes. Proxy flows reading one get an empty value.', business: 'No extra labels on this persona.' })}
                    </div>
                  ) : (
                    customAttributesList.map((attr: { name: string; value: string }) => (
                      <div
                        key={attr.name}
                        className="flex items-center justify-between gap-2.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-mono"
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <span className="font-bold text-slate-800">{attr.name}</span>
                          <span className="text-slate-400">=</span>
                          <input
                            type="text"
                            value={attr.value}
                            onChange={(e) => setProductAttr(attr.name, e.target.value)}
                            className="flex-1 bg-white border border-slate-200 rounded px-2 py-0.5 text-slate-700 text-xs focus:outline-none"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeProductAttr(attr.name)}
                          className="text-slate-400 hover:text-rose-600 transition p-1 cursor-pointer"
                          title={sp({ technical: 'Delete this attribute (flows reading it get an empty value after save)', business: 'Remove label' })}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}

                  {/* Add new attribute row */}
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      placeholder={sp({ technical: 'Attribute name (flow variable suffix)...', business: 'Label name...' })}
                      value={newCustomAttrKey}
                      onChange={(e) => setNewCustomAttrKey(e.target.value)}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                    <input
                      type="text"
                      placeholder={sp({ technical: 'Attribute value (string)...', business: 'Label value...' })}
                      value={newCustomAttrVal}
                      onChange={(e) => setNewCustomAttrVal(e.target.value)}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newCustomAttrKey.trim()) return;
                        setProductAttr(newCustomAttrKey.trim(), newCustomAttrVal.trim());
                        setNewCustomAttrKey('');
                        setNewCustomAttrVal('');
                      }}
                      disabled={!newCustomAttrKey.trim()}
                      className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </button>
                  </div>
                </div>
              </div>
              </RoleGate>
            )}
          </div>
        )}

        {/* SUB-TAB 1: DEVELOPER WALLETS & TOP-UP */}
        {activeSubTab === 'wallets' && (
          <RoleGate role={adminRole} capability="wallet" onSwitchRole={onAdminRoleChange} lockInputs={false}>
          <div className="space-y-6">
            {/* Fleet Overview KPI Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {sp({ technical: 'Registered Accounts', finance: 'Users' })}
                  </span>
                  <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
                    {userAttributions.length}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {sp({ technical: 'Developers with keys on any persona product', finance: 'People whose AI use is charged here' })}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-purple-50 border border-purple-200 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-purple-600" />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {sp({ technical: 'Total Fleet Token Spend', finance: 'Total AI spend' })}
                  </span>
                  <div className="text-2xl font-bold font-mono text-amber-600 mt-1">
                    ${userAttributions.reduce((acc, u) => acc + (u.totalConsumedUsd || 0), 0).toFixed(2)}{' '}
                    <span className="text-xs font-sans text-slate-500 font-normal">USD</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {userAttributions.reduce((acc, u) => acc + (u.totalCalls || 0), 0).toLocaleString()} {sp({ technical: 'metered calls', finance: 'requests' })} • {(() => {
                      const tot = userAttributions.reduce((acc, u) => acc + (u.totalTokens || 0), 0);
                      return tot >= 1_000_000 ? `${(tot / 1e6).toFixed(2)}M tokens` : tot >= 1_000 ? `${(tot / 1e3).toFixed(1)}k tokens` : `${tot} tokens`;
                    })()}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
                  <Coins className="w-5 h-5 text-amber-600" />
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    {sp({ technical: 'Available Prepaid Pool', finance: 'Prepaid credit left' })}
                  </span>
                  <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
                    ${userAttributions.reduce((acc, u) => acc + (u.currentBalanceUsd || 0), 0).toFixed(2)}{' '}
                    <span className="text-xs font-sans text-slate-500 font-normal">USD</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {sp({ technical: 'Prepaid calls are refused at $0', finance: 'Already paid for, not yet spent' })}
                  </div>
                </div>
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </div>

            {/* Enterprise User & Persona Attribution: Consumed vs Balance */}
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{byRole('Developer & Persona Attribution (Consumed vs Balance)', 'Spend and credit left, by user', 'Usage and credit left, by user')}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {sp({
                      technical: 'Metered spend per developer from the rate card, against wallet balance. Red rows are prepaid at $0: the gateway is refusing their calls right now.',
                      finance: 'What each person has spent on AI and how much prepaid credit they have left. Red rows have run out and are blocked until topped up.',
                    })}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={userAttributionSearch}
                      onChange={(e) => setUserAttributionSearch(e.target.value)}
                      placeholder={sp({ technical: 'Filter by developer, email or product...', finance: 'Find a person or team...' })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </div>

              {/* Attribution Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-sans">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] tracking-wider font-semibold select-none">
                      <th
                        onClick={() => handleAttributionSort('name')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by developer', finance: 'Sort by person' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'name' ? 'text-slate-900 font-bold' : ''}>User & Persona</span>
                          {attributionSortColumn === 'name' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleAttributionSort('tier')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by entitlement (API product)', finance: 'Sort by plan' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'tier' ? 'text-slate-900 font-bold' : ''}>{s('Entitlement', 'Plan')}</span>
                          {attributionSortColumn === 'tier' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleAttributionSort('billing')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by billing type (prepaid first or last)', finance: 'Sort by how they are billed' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'billing' ? 'text-slate-900 font-bold' : ''}>{s('Billing Mode', 'Billing')}</span>
                          {attributionSortColumn === 'billing' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleAttributionSort('consumed')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by metered spend', finance: 'Sort by spend' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'consumed' ? 'text-slate-900 font-bold' : ''}>{s('Total Consumed', 'Spent')}</span>
                          {attributionSortColumn === 'consumed' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleAttributionSort('balance')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by wallet balance', finance: 'Sort by credit left' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'balance' ? 'text-slate-900 font-bold' : ''}>{s('Active Balance', 'Credit left')}</span>
                          {attributionSortColumn === 'balance' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th
                        onClick={() => handleAttributionSort('quota')}
                        className="pb-3 cursor-pointer hover:text-slate-900 transition group/th"
                        title={sp({ technical: 'Sort by share of wallet consumed (closest to a block first when descending)', finance: 'Sort by share of credit used' })}
                      >
                        <div className="flex items-center gap-1">
                          <span className={attributionSortColumn === 'quota' ? 'text-slate-900 font-bold' : ''}>{s('Wallet Status & Quota', 'Credit used')}</span>
                          {attributionSortColumn === 'quota' ? (
                            attributionSortDirection === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-slate-400 group-hover/th:text-slate-600 transition shrink-0 opacity-60 group-hover/th:opacity-100" />
                          )}
                        </div>
                      </th>
                      <th className="pb-3 text-right">{sp({ technical: 'Actions', finance: 'Top up' })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-xs">
                    {sortedUserAttributions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500 font-sans">
                          {sp({
                            technical: <>No developer, email or product matches &ldquo;{userAttributionSearch}&rdquo;</>,
                            finance: <>Nobody matches &ldquo;{userAttributionSearch}&rdquo;. Try a name, email or team.</>,
                          })}
                        </td>
                      </tr>
                    ) : (
                      sortedUserAttributions.map((user) => {
                      const isSelected = user.userEmail.toLowerCase() === selectedDeveloper.toLowerCase();
                      const isPrepaid = user.billingType === 'PREPAID';
                      const isDepleted = isPrepaid && (user.currentBalanceUsd <= 0);

                      const totalAllocated = (user.totalConsumedUsd || 0) + (user.currentBalanceUsd || 0);
                      const consumedPct = totalAllocated > 0
                        ? Math.min(100, Math.round(((user.totalConsumedUsd || 0) / totalAllocated) * 100))
                        : 0;

                      return (
                        <tr
                          key={user.userEmail}
                          onClick={() => setSelectedDeveloper(user.userEmail)}
                          className={`cursor-pointer transition group ${
                            isSelected
                              ? 'bg-emerald-50/70'
                              : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* User & Persona */}
                          <td className="py-3 font-sans">
                            <div className="flex items-center gap-2.5">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isSelected
                                    ? 'bg-emerald-500 animate-pulse ring-2 ring-emerald-400/30'
                                    : isDepleted
                                    ? 'bg-rose-500'
                                    : isPrepaid
                                    ? 'bg-emerald-500'
                                    : 'bg-blue-400'
                                }`}
                              />
                              <div>
                                <div className="font-semibold text-slate-900 group-hover:text-slate-900 flex items-center gap-1.5">
                                  <span>{user.name}</span>
                                  {isSelected && (
                                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                                      ACTIVE
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-mono">
                                  {user.userEmail}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Entitlement Tier */}
                          <td className="py-3 font-sans">
                            <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                              user.badge === 'SSO Caller' || user.tier === PERSONAS[0].label
                                ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              {user.badge || user.tier || Term(voice, 'developer')}
                            </span>
                          </td>

                          {/* Billing Mode */}
                          <td className="py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                              isPrepaid
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}>
                              {s(user.billingType, isPrepaid ? 'Prepaid' : 'Invoiced')}
                            </span>
                          </td>

                          {/* Consumed (Sum) */}
                          <td className="py-3">
                            <div
                              className="font-bold text-slate-900"
                              title={sp({
                                technical: `Exact metered spend: $${Number(user.totalConsumedUsd || 0).toFixed(6)} USD`,
                                finance: `Exact spend: $${Number(user.totalConsumedUsd || 0).toFixed(6)} USD`,
                              })}
                            >
                              ${Number(user.totalConsumedUsd || 0).toFixed(2)}{' '}
                              <span className="text-[10px] font-normal text-slate-500 font-sans">USD</span>
                            </div>
                            <div className="text-[10px] text-slate-500 font-sans">
                              {(user.totalCalls || 0).toLocaleString()} {sp({ technical: 'calls', finance: 'requests' })} • {(() => {
                                const tot = user.totalTokens || 0;
                                return tot >= 1_000_000 ? `${(tot / 1e6).toFixed(2)}M tokens` : tot >= 1_000 ? `${(tot / 1e3).toFixed(1)}k tokens` : `${tot} tokens`;
                              })()}
                            </div>
                          </td>

                          {/* Active Balance */}
                          <td className="py-3">
                            {isPrepaid ? (
                              <>
                                <div
                                  className={`font-bold ${isDepleted ? 'text-rose-600' : 'text-emerald-600'}`}
                                  title={sp({
                                    technical: `Exact wallet balance: $${Number(user.currentBalanceUsd || 0).toFixed(6)} USD`,
                                    finance: `Exact credit left: $${Number(user.currentBalanceUsd || 0).toFixed(6)} USD`,
                                  })}
                                >
                                  ${Number(user.currentBalanceUsd || 0).toFixed(2)}{' '}
                                  <span className="text-[10px] font-normal text-slate-500 font-sans">USD</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-sans">
                                  {isDepleted ? sp({ technical: 'Depleted: calls refused', finance: 'Used up: blocked until top-up' }) : sp({ technical: 'Passing balance check', finance: 'Credit available' })}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="font-bold text-slate-600">
                                  N/A <span className="text-[10px] font-normal text-slate-500 font-sans">({sp({ technical: 'no wallet', finance: 'Invoiced' })})</span>
                                </div>
                                <div className="text-[10px] text-slate-500 font-sans">
                                  {sp({ technical: 'Postpaid: no balance check', finance: 'Billed monthly, no hard stop' })}
                                </div>
                              </>
                            )}
                          </td>

                          {/* Consumed vs Balance Health */}
                          <td className="py-3 w-48 font-sans">
                            <div className="space-y-1">
                              <div className="flex items-center justify-between text-[10px]">
                                {isPrepaid ? (
                                  <>
                                    <span className="text-slate-500 font-mono">{consumedPct}% {sp({ technical: 'Used', finance: 'spent' })}</span>
                                    <span className={`font-mono font-semibold ${isDepleted ? 'text-rose-600' : 'text-emerald-600'}`}>
                                      {isDepleted ? sp({ technical: 'BLOCKING', finance: 'USED UP' }) : sp({ technical: 'HEALTHY', finance: 'OK' })}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="text-slate-500 font-mono">{sp({ technical: 'Invoiced', finance: 'Invoiced' })}</span>
                                    <span className="font-mono font-semibold text-blue-600">{sp({ technical: 'POSTPAID', finance: 'MONTHLY' })}</span>
                                  </>
                                )}
                              </div>
                              <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                {isPrepaid ? (
                                  <div
                                    className={`h-full rounded-full ${
                                      isDepleted
                                        ? 'bg-rose-500'
                                        : consumedPct > 75
                                        ? 'bg-amber-500'
                                        : 'bg-emerald-500'
                                    }`}
                                    style={{ width: `${isDepleted ? 100 : Math.max(6, consumedPct)}%` }}
                                  />
                                ) : (
                                  <div
                                    className="h-full rounded-full bg-blue-400"
                                    style={{ width: '100%' }}
                                  />
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3 text-right font-sans">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDeveloper(user.userEmail);
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                                  isSelected
                                    ? 'bg-emerald-600 text-white shadow-xs'
                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                }`}
                                title={sp({ technical: 'Load this developer\'s wallet and billing config into the header controls', finance: 'Show this person\'s prepaid credit and billing' })}
                              >
                                {isSelected ? 'Selected' : 'Select'}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDeveloper(user.userEmail);
                                  setShowCustomTopUpModal(true);
                                }}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 transition cursor-pointer flex items-center gap-1 shadow-xs"
                                title={sp({ technical: 'Credit this wallet. Takes effect on the next balance check, org-wide (Dev and Prod).', finance: 'Add prepaid credit so this person can keep using AI' })}
                              >
                                <Plus className="w-3 h-3" />
                                <span>{sp({ technical: 'Credit', finance: 'Top up' })}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          </RoleGate>
        )}

        {/* SUB-TAB 2: KVM MODEL RATE CARDS */}
        {activeSubTab === 'rate-cards' && (
          <RoleGate role={adminRole} capability="pricing" onSwitchRole={onAdminRoleChange} lockInputs={false}>
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={sp({ technical: 'Filter KVM entries by model ID (e.g., gemini-3.1, claude-opus, flash)...', finance: 'Find a model price (e.g., gemini-3.1, claude-opus, flash)...' })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterProvider('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                      filterProvider === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterProvider('google')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                      filterProvider === 'google' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <GoogleLogo className="w-3.5 h-3.5" />
                    <span>Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterProvider('anthropic')}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition cursor-pointer ${
                      filterProvider === 'anthropic' ? 'bg-stone-900 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <AnthropicLogo className="w-3.5 h-3.5" />
                    <span>Anthropic</span>
                  </button>
                </div>

                {hasRateChanges && (
                  <button
                    type="button"
                    onClick={() => setRates(JSON.parse(JSON.stringify(initialRates)))}
                    disabled={ratesSaving}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{sp({ technical: 'Revert', finance: 'Undo' })}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  title={sp({ technical: 'Add a KVM rate entry. Unpriced models are metered at "default".', finance: 'Set a price for a model not listed yet (otherwise it is charged the default price)' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-amber-500" />
                  <span>{sp({ technical: 'Add Model', finance: 'Add price' })}</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveKvmRates}
                  disabled={!hasRateChanges || ratesSaving || ratesLoading}
                  title={isProdView
                    ? sp({ technical: 'Prod rate card is read-only: change Dev, then promote with a PR', finance: 'Live prices are view only: changes need an approved change request' })
                    : sp({ technical: 'Write the Dev rate-card KVM. Dev proxies meter new calls at these rates.', finance: 'Save these prices in the Sandbox' })}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                    hasRateChanges
                      ? 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white ring-2 ring-amber-400/40'
                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  }`}
                >
                  <Save className={`w-3.5 h-3.5 ${ratesSaving ? 'animate-spin' : ''}`} />
                  <span>{ratesSaving ? 'Saving...' : sp({ technical: 'Save to KVM', finance: 'Save prices' })}</span>
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200 font-bold">
                    <tr>
                      <th className="py-3 px-4">{sp({ technical: 'Model Identifier', finance: 'Model' })}</th>
                      <th className="py-3 px-4">Provider</th>
                      <th className="py-3 px-4" title={sp({ technical: 'Tier label stored with the rate; used for reporting, not enforcement', finance: 'Rough price band, for reports' })}>{sp({ technical: 'Cost Tier', finance: 'Price band' })}</th>
                      <th className="py-3 px-4" title={sp({ technical: 'USD per 1M prompt tokens, applied by the metering policy', finance: 'What we charge per million tokens sent to the model' })}>{sp({ technical: 'Input Rate ($/1M)', finance: 'Input price ($/1M)' })}</th>
                      <th className="py-3 px-4" title={sp({ technical: 'USD per 1M completion tokens, applied by the metering policy', finance: 'What we charge per million tokens the model writes back' })}>{sp({ technical: 'Output Rate ($/1M)', finance: 'Output price ($/1M)' })}</th>
                      <th className="py-3 px-4" title={sp({ technical: 'Metered cost of a 1k prompt + 1k completion call', finance: 'Cost of a typical request: 1k tokens in, 1k out' })}>{sp({ technical: 'Sample 1k/1k Call', finance: '1k in + 1k out' })}</th>
                      <th className="py-3 px-4 text-right">{sp({ technical: 'Actions', finance: 'Remove' })}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {ratesLoading ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center text-slate-500">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-amber-500" />
                          {sp({ technical: `Reading the ${env === 'prod' ? 'Prod' : 'Dev'} rate-card KVM...`, finance: 'Loading model prices...' })}
                        </td>
                      </tr>
                    ) : filteredModels.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          {sp({ technical: 'No KVM entry matches. Unlisted models are metered at "default".', finance: 'No model price matches. Unlisted models are charged the default price.' })}
                        </td>
                      </tr>
                    ) : (
                      filteredModels.map(([modelId, item]) => {
                        const sampleCallCost = ((item.input * 0.001) + (item.output * 0.001)).toFixed(6);
                        const isDefault = modelId === 'default';

                        return (
                          <tr key={modelId} className="hover:bg-slate-50 transition">
                            <td className="py-3 px-4 font-medium text-slate-900 flex items-center gap-2">
                              <span className={isDefault ? 'text-amber-600 font-bold' : 'text-slate-800'}>
                                {modelId}
                              </span>
                              {isDefault && (
                                <span className="text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded border border-amber-300">
                                  {sp({ technical: 'Default Fallback', finance: 'Fallback price' })}
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 font-sans">
                              {item.provider === 'anthropic' ? (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-stone-800 bg-stone-100 border border-stone-200 px-2 py-0.5 rounded-md">
                                  <AnthropicLogo className="w-3 h-3" />
                                  <span>Anthropic Vertex</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                  <GoogleLogo className="w-3 h-3" />
                                  <span>Google Gemini</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 font-sans">
                              <select
                                value={item.tier || 'medium'}
                                onChange={(e) => handleTierChange(modelId, e.target.value)}
                                className="bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-[11px] font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer"
                              >
                                <option value="low">Low (Flash)</option>
                                <option value="medium">Medium</option>
                                <option value="high">High (Pro/Opus)</option>
                              </select>
                            </td>

                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400">$</span>
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={item.input}
                                  onChange={(e) => handleRateChange(modelId, 'input', e.target.value)}
                                  className="w-24 bg-white border border-slate-300 hover:border-slate-400 focus:border-amber-500 rounded-lg px-2.5 py-1 text-slate-900 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-xs"
                                />
                              </div>
                            </td>

                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <span className="text-slate-400 font-mono text-xs">$</span>
                                <input
                                  type="number"
                                  step="0.001"
                                  min="0"
                                  value={item.output}
                                  onChange={(e) => handleRateChange(modelId, 'output', e.target.value)}
                                  className="w-24 bg-white border border-slate-300 hover:border-slate-400 focus:border-amber-500 rounded-lg px-2.5 py-1 text-slate-900 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 shadow-xs"
                                />
                              </div>
                            </td>

                            <td className="py-3 px-4 font-mono text-emerald-600 font-semibold">
                              ${sampleCallCost}
                            </td>

                            <td className="py-3 px-4 text-right font-sans">
                              {!isDefault && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteModel(modelId)}
                                  className="text-slate-400 hover:text-rose-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                                  title={sp({ technical: `Delete ${modelId}: after save it is metered at "default"`, finance: `Remove the ${modelId} price: it would then be charged the default price` })}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Interactive Cost & Budget Simulator */}
            <div className="p-5 rounded-2xl border border-slate-200 bg-white shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-amber-500" />
                  <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                    {sp({ technical: 'Interactive Cost & Wallet Deduction Simulator', finance: 'What a request costs' })}
                  </h2>
                </div>
                {sp({
                  technical: (
                    <span className="text-[10px] text-slate-500 font-mono">
                      Same rating as <span className="text-emerald-600 font-semibold">CalculateCost.js</span> on the proxy (unsaved rates included)
                    </span>
                  ),
                  finance: <span className="text-[10px] text-slate-500">Same maths the gateway uses to charge, including unsaved prices</span>,
                })}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                    {sp({ technical: 'Target Model', finance: 'Model' })}
                  </label>
                  <select
                    value={calcModel}
                    onChange={(e) => setCalcModel(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-slate-900 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-amber-500 cursor-pointer shadow-xs"
                  >
                    {Object.keys(rates).map((m) => (
                      <option key={m} value={m}>
                        {m} ({rates[m]?.provider || 'custom'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-slate-500">{sp({ technical: 'Prompt Tokens', finance: 'Question (tokens)' })}</label>
                    <span className="font-mono text-amber-600 font-bold">{calcPromptTokens.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="50000"
                    step="50"
                    value={calcPromptTokens}
                    onChange={(e) => setCalcPromptTokens(parseInt(e.target.value, 10))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-[10px] uppercase font-bold text-slate-500">{sp({ technical: 'Output Tokens', finance: 'Answer (tokens)' })}</label>
                    <span className="font-mono text-emerald-600 font-bold">{calcOutputTokens.toLocaleString()}</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="10000"
                    step="50"
                    value={calcOutputTokens}
                    onChange={(e) => setCalcOutputTokens(parseInt(e.target.value, 10))}
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col justify-center">
                  <div className="text-[10px] uppercase font-bold text-slate-500">{sp({ technical: 'Calculated Cost', finance: 'Cost per request' })}</div>
                  <div className="text-lg font-bold text-amber-600 font-mono mt-0.5">
                    ${calculatedCost.total.toFixed(6)} <span className="text-xs text-slate-500 font-normal">USD</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {sp({ technical: 'Wallet debit:', finance: 'Taken from credit:' })} <span className="text-emerald-600 font-bold">{calculatedCost.micros}</span> {sp({ technical: 'micros (min 1 per call)', finance: 'millionths of a dollar' })}
                  </div>
                </div>
              </div>
            </div>
          </div>
          </RoleGate>
        )}

        {/* SUB-TAB 3: PRODUCT RATE PLANS & SUBSCRIPTIONS */}
        {activeSubTab === 'policies' && (
          <RoleGate role={adminRole} capability="guardrails" onSwitchRole={onAdminRoleChange} lockInputs={false}>
          <GuardrailsPoliciesView onInspectArchitecture={onInspectArchitecture} />
          </RoleGate>
        )}

        {activeSubTab === 'rate-plans' && (
          <RoleGate role={adminRole} capability="rate_plans" onSwitchRole={onAdminRoleChange} lockInputs={false}>
          <div className="space-y-6">
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-purple-600" />
                    <span>{sp({ technical: 'Published Product Rate Plans', finance: 'Billing plans' })}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {sp({
                      technical: 'Apigee Monetization rate plans on each persona product. Only PUBLISHED plans rate traffic; subscriptions are org-level, so edits reach Dev and Prod together.',
                      finance: 'How each team is charged for AI use: the setup fee, the recurring fee and the billing cycle. Everyone enrolled in a plan is billed on it.',
                    })}
                  </p>
                </div>
              </div>

              {plansLoading ? (
                <div className="py-12 text-center text-slate-500">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-purple-500" />
                  {sp({ technical: 'Reading rate plans from the Monetization API...', finance: 'Loading billing plans...' })}
                </div>
              ) : ratePlans.length === 0 ? (
                <div className="py-8 text-center text-slate-500">
                  {sp({ technical: 'No rate plans in this org, so no traffic is being rated. Provision them with `deploy_all.sh`.', finance: 'No billing plans are set up yet, so nobody is being billed on a plan.' })}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ratePlans.map((plan) => {
                    const isPublished = plan.state === 'PUBLISHED';
                    return (
                      <div
                        key={plan.name}
                        className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 relative overflow-hidden"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-purple-600 tracking-wider">
                              {sp({ technical: plan.apiproduct, finance: personaByProduct(plan.apiproduct) })}
                            </span>
                            <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                              {plan.displayName || plan.name}
                            </h4>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                              isPublished
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-500 border-slate-200'
                            }`}
                          >
                            {plan.state}
                          </span>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200 text-xs font-mono">
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-sans">{sp({ technical: 'Billing Period', finance: 'Billing Cycle' })}</div>
                            <div className="text-slate-800 mt-0.5">{plan.billingPeriod}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-sans">Currency</div>
                            <div className="text-emerald-600 mt-0.5 font-bold">{plan.currencyCode}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-500 uppercase font-sans">{sp({ technical: 'Consumption', finance: 'Pricing Model' })}</div>
                            <div className="text-slate-800 mt-0.5 truncate">{plan.consumptionPricingType}</div>
                          </div>
                        </div>

                        <div className="text-[10px] font-mono text-slate-400 truncate pt-1 border-t border-slate-200">
                          {sp({ technical: 'Rate plan ID', finance: 'Plan ref' })}: {plan.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Developer Active Subscriptions */}
            <div className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-600" />
                    <span>{sp({ technical: 'Active Developer Subscriptions for', finance: 'Enrolments for' })} {selectedDeveloper}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {sp({
                      technical: 'Without an active subscription the monetization check refuses this developer\'s calls on that product (403), whatever their key allows. Subscribing takes effect on the next call.',
                      finance: 'A person is only billed for, and can only use, the teams they are enrolled in. Enrolling starts billing on that team\'s plan straight away.',
                    })}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {PERSONAS.map((persona) => persona.product).map((prod) => {
                  const isSubscribed = subscriptions.some((s) => s.apiproduct === prod);
                  return (
                    <div
                      key={prod}
                      className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-bold text-slate-900">{personaByProduct(prod)}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-1.5">
                          {isSubscribed ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-600 font-medium">{sp({ technical: 'Active: calls rated', finance: 'Enrolled and billed' })}</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                              <span className="text-rose-600 font-medium">{sp({ technical: 'Not Subscribed (403 Blocked)', finance: 'Not enrolled (blocked)' })}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {!isSubscribed && (
                        <button
                          type="button"
                          onClick={() => handleSubscribeProduct(prod)}
                          disabled={subscribingProduct === prod}
                          title={sp({ technical: `Create a subscription to ${prod} (org-level: applies in Dev and Prod)`, finance: `Enrol and start billing on the ${personaByProduct(prod)} plan` })}
                          className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-xs transition cursor-pointer disabled:opacity-50"
                        >
                          {subscribingProduct === prod ? sp({ technical: 'Subscribing...', finance: 'Enrolling...' }) : sp({ technical: 'Subscribe', finance: 'Enrol' })}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </RoleGate>
        )}
      </div>

      {/* Custom Top-Up Modal */}
      {showCustomTopUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-500" />
                <h3 className="font-bold text-slate-900 text-base">{sp({ technical: 'Credit Prepaid Wallet', finance: 'Add prepaid credit' })}</h3>
              </div>
              <button
                onClick={() => setShowCustomTopUpModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {sp({ technical: 'Developer Account', finance: 'Person' })}
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedDeveloper}
                  className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-bold">{sp({ technical: 'Billing Type', finance: 'Billing' })}</div>
                  <div className="text-xs font-bold font-mono text-slate-900">{billingLabel(monetizationConfig.billingType)}</div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleBillingType}
                  disabled={configSaving}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium transition cursor-pointer disabled:opacity-50"
                  title={sp({
                    technical: 'PREPAID: every call is balance-checked and refused at $0. POSTPAID: no check, usage accrues for invoicing. Org-level, applies to Dev and Prod.',
                    finance: 'Prepaid stops use when credit runs out, so spend can never overrun. Invoiced has no hard stop and is billed monthly.',
                  })}
                >
                  {configSaving ? 'Updating...' : `Switch to ${billingLabel(monetizationConfig.billingType === 'PREPAID' ? 'POSTPAID' : 'PREPAID')}`}
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-slate-700">
                    {sp({ technical: 'Credit Amount (USD)', finance: 'Amount (USD)' })}
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">{sp({ technical: 'Next call sees it', finance: 'Available at once' })}</span>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm">$</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    required
                    value={customTopUpAmount}
                    onChange={(e) => setCustomTopUpAmount(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl pl-8 pr-3 py-2 text-slate-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 shadow-xs"
                  />
                </div>
                <div className="flex items-center gap-1.5 pt-2">
                  {['10', '25', '50', '100'].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setCustomTopUpAmount(amt)}
                      className={`flex-1 py-1 rounded-lg text-xs font-mono font-semibold transition cursor-pointer ${
                        customTopUpAmount === amt
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                      }`}
                    >
                      +${amt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowCustomTopUpModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleCreditWallet(customTopUpAmount)}
                  disabled={topUpLoading}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-md shadow-emerald-500/20 cursor-pointer disabled:opacity-50"
                >
                  {topUpLoading ? 'Processing...' : sp({ technical: 'Credit wallet', finance: 'Add credit' })}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Model Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-slate-900 text-base">{sp({ technical: 'Add Model Rate Card', finance: 'Add model price' })}</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddModel} className="space-y-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                  {sp({ technical: 'KVM key: model ID (exact or prefix match)', finance: 'Model name (exact, or the start of it)' })}
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., gemini-3.1-pro-preview, claude-opus-4-5@20251101"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 shadow-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Provider</label>
                  <select
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value as any)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 cursor-pointer shadow-xs"
                  >
                    <option value="google">Google Gemini</option>
                    <option value="anthropic">Anthropic Vertex</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">{sp({ technical: 'Cost Tier', finance: 'Price band' })}</label>
                  <select
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value as any)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 cursor-pointer shadow-xs"
                  >
                    <option value="low">Low (Flash)</option>
                    <option value="medium">Medium</option>
                    <option value="high">High (Pro/Opus)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {sp({ technical: 'Input Rate ($/1M tokens)', finance: 'Input price ($/1M tokens)' })}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    required
                    value={newInputRate}
                    onChange={(e) => setNewInputRate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 shadow-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    {sp({ technical: 'Output Rate ($/1M tokens)', finance: 'Output price ($/1M tokens)' })}
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    required
                    value={newOutputRate}
                    onChange={(e) => setNewOutputRate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 shadow-xs"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                {sp({
                  technical: 'Staged locally until you Save to KVM. Once saved, Dev proxies meter matching calls at this rate; Prod picks it up only via PR.',
                  finance: 'Nothing is charged at this price until you save, and Live charges change only after approval.',
                })}
              </p>

              <div className="pt-3 border-t border-slate-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold shadow-md shadow-amber-500/20 cursor-pointer"
                >
                  {sp({ technical: 'Stage rate', finance: 'Add price' })}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Product Reset Confirmation Modal */}
      {showProductResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                  <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Reset {devLabel} to match {prodLabel}</h3>
                  <p className="text-xs text-slate-500">
                    {sp({ technical: 'Re-clone the Prod API product over its Dev copy', business: 'Start over from the live setup' })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowProductResetModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              {sp({
                technical: 'Overwrites the Dev product with Prod\'s models, token quotas, routing targets and budget attributes. Every unmerged Dev edit is lost, including Ask Apigee changes and work someone may still want in a PR. Dev proxies enforce the Prod config from the next call; Prod is not touched. Resetting one product leaves the others as they are.',
                business: 'Copies the live setup (allowed models, usage limits, automatic model choice and budgets) into the Sandbox and throws away Sandbox-only changes, including ones made by Ask Apigee. Live is not touched.',
              })}
            </p>

            <div className="pt-2 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProductResetModal(false)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleResetProduct(selectedProductName as any)}
                disabled={productResetting}
                className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {productResetting ? 'Resetting...' : sp({ technical: `Reset ${selectedProductName} (Dev)`, business: `Reset ${personaByProduct(selectedProductName)}` })}
              </button>
              <button
                type="button"
                onClick={() => handleResetProduct('all')}
                disabled={productResetting}
                className="px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
              >
                {productResetting ? 'Resetting All...' : sp({ technical: 'Reset all Dev products', business: 'Reset all personas' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompare && <EnvCompareModal onClose={() => setShowCompare(false)} />}

      {roleNotice && (
        <RoleNoticeModal
          role={adminRole}
          capability={roleNotice}
          onClose={() => setRoleNotice(null)}
          onSwitchRole={onAdminRoleChange}
        />
      )}

      {showProdNotice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="prod-readonly-title"
        >
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                <GitPullRequest className="w-5 h-5" />
              </div>
              <h3 id="prod-readonly-title" className="text-sm font-bold text-slate-900">{sp({ technical: 'Prod changes go through a pull request', business: 'Changes to Live need approval' })}</h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              {sp({
                technical: `${PROD_READ_ONLY_MESSAGE} The server refuses Prod writes too, so this is not just a UI lock. Use Compare Dev ↔ Prod to see exactly what the PR would change.`,
                finance: 'Live budgets and prices are view only. Make the change in the Sandbox and send it for approval; users are charged the new amounts only once the change request is approved.',
                ai_coe: 'Live model and routing settings are view only. Make the change in the Sandbox, try it, then send it for approval; teams see it once the change request is approved.',
              })}
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowProdNotice(false)}
                className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => { setShowProdNotice(false); setEnv('dev'); }}
                className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
              >
                Switch to {devLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
