import React, { useState, useEffect, useCallback } from 'react';
import { userApi, batchApi, discountApi, tagApi } from './api';

const STATUS_MAP = {
  active: { label: '在售', color: '#52c41a' },
  expired: { label: '已过期', color: '#ff4d4f' },
  discounted: { label: '折扣中', color: '#faad14' },
  removed: { label: '已下架', color: '#999' },
};

const DISCOUNT_STATUS_MAP = {
  draft: { label: '草稿', color: '#1890ff' },
  published: { label: '已发布', color: '#52c41a' },
  rejected: { label: '已拒绝', color: '#ff4d4f' },
  revoked: { label: '已撤销', color: '#999' },
};

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 12,
      fontSize: 12, color: '#fff', backgroundColor: color, fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function Alert({ type, msg, detail }) {
  const bg = type === 'error' ? '#fff2f0' : type === 'success' ? '#f6ffed' : '#fffbe6';
  const border = type === 'error' ? '#ffccc7' : type === 'success' ? '#b7eb8f' : '#ffe58f';
  const color = type === 'error' ? '#cf1322' : type === 'success' ? '#389e0d' : '#d48806';
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: '10px 16px', margin: '8px 0' }}>
      <div style={{ color, fontWeight: 600, fontSize: 14 }}>{msg}</div>
      {detail && <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>{JSON.stringify(detail)}</div>}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loginName, setLoginName] = useState('manager1');
  const [tab, setTab] = useState('batches');
  const [batches, setBatches] = useState([]);
  const [discounts, setDiscounts] = useState([]);
  const [tags, setTags] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const pushAlert = useCallback((a) => {
    const id = Date.now();
    setAlerts(prev => [...prev, { ...a, id }]);
    setTimeout(() => setAlerts(prev => prev.filter(x => x.id !== id)), 6000);
  }, []);

  const loadData = useCallback(async () => {
    const [b, d, t] = await Promise.all([batchApi.list(), discountApi.list(), tagApi.list()]);
    if (b.ok) setBatches(b.data);
    if (d.ok) setDiscounts(d.data);
    if (t.ok) setTags(t.data);
  }, []);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const handleLogin = async () => {
    const res = await userApi.login(loginName);
    if (res.ok) { setUser(res.data); }
    else { pushAlert({ type: 'error', msg: res.msg }); }
  };

  const handleLogout = () => { setUser(null); setAlerts([]); };

  if (!user) {
    return (
      <div style={styles.loginWrap}>
        <div style={styles.loginCard}>
          <h2 style={{ textAlign: 'center', marginBottom: 24 }}>🏪 生鲜门店临期折扣系统</h2>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 14, fontWeight: 600 }}>用户名</label>
            <select value={loginName} onChange={e => setLoginName(e.target.value)} style={styles.input}>
              <option value="manager1">manager1（店长）</option>
              <option value="admin1">admin1（管理员）</option>
            </select>
          </div>
          <button onClick={handleLogin} style={styles.btnPrimary}>登 录</button>
          {alerts.map(a => <Alert key={a.id} type={a.type} msg={a.msg} />)}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h2 style={{ margin: 0 }}>🏪 生鲜临期折扣管理</h2>
        <div>
          <span style={{ marginRight: 12, fontSize: 14 }}>
            {user.display_name}（{user.role === 'store_manager' ? '店长' : '管理员'}）
          </span>
          <button onClick={handleLogout} style={styles.btnSm}>退出</button>
        </div>
      </header>

      <div style={styles.alertArea}>
        {alerts.map(a => <Alert key={a.id} type={a.type} msg={a.msg} detail={a.detail} />)}
      </div>

      <nav style={styles.nav}>
        {['batches', 'discounts', 'tags'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ ...styles.navBtn, ...(tab === t ? styles.navBtnActive : {}) }}>
            {t === 'batches' ? '📦 商品批次' : t === 'discounts' ? '💰 折扣规则' : '🏷️ 价签记录'}
          </button>
        ))}
      </nav>

      <main style={styles.main}>
        {tab === 'batches' && <BatchPanel batches={batches} pushAlert={pushAlert} loadData={loadData} user={user} />}
        {tab === 'discounts' && <DiscountPanel discounts={discounts} batches={batches} pushAlert={pushAlert} loadData={loadData} user={user} />}
        {tab === 'tags' && <TagPanel tags={tags} />}
      </main>
    </div>
  );
}

function BatchPanel({ batches, pushAlert, loadData, user }) {
  const [form, setForm] = useState({
    product_name: '', sku: '', cost_price: '', retail_price: '',
    production_date: '', shelf_life_days: '', min_profit_rate: '5',
  });

  const submit = async () => {
    const body = {
      ...form,
      cost_price: parseFloat(form.cost_price),
      retail_price: parseFloat(form.retail_price),
      shelf_life_days: parseInt(form.shelf_life_days, 10),
      min_profit_rate: parseFloat(form.min_profit_rate) / 100,
      created_by: user.id,
    };
    const res = await batchApi.create(body);
    if (res.ok) {
      pushAlert({ type: res.warning ? 'warn' : 'success', msg: res.warning || '批次创建成功' });
      setForm({ product_name: '', sku: '', cost_price: '', retail_price: '', production_date: '', shelf_life_days: '', min_profit_rate: '5' });
      loadData();
    } else {
      pushAlert({ type: 'error', msg: res.msg });
    }
  };

  return (
    <div>
      <h3>新增商品批次</h3>
      <div style={styles.formGrid}>
        <input placeholder="商品名称" value={form.product_name} onChange={e => setForm({ ...form, product_name: e.target.value })} style={styles.input} />
        <input placeholder="SKU编码" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} style={styles.input} />
        <input placeholder="成本价" type="number" step="0.01" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} style={styles.input} />
        <input placeholder="零售价" type="number" step="0.01" value={form.retail_price} onChange={e => setForm({ ...form, retail_price: e.target.value })} style={styles.input} />
        <input placeholder="生产日期" type="date" value={form.production_date} onChange={e => setForm({ ...form, production_date: e.target.value })} style={styles.input} />
        <input placeholder="保质期(天)" type="number" value={form.shelf_life_days} onChange={e => setForm({ ...form, shelf_life_days: e.target.value })} style={styles.input} />
        <input placeholder="最低毛利率(%)" type="number" step="0.1" value={form.min_profit_rate} onChange={e => setForm({ ...form, min_profit_rate: e.target.value })} style={styles.input} />
        <button onClick={submit} style={styles.btnPrimary}>提交批次</button>
      </div>

      <h3 style={{ marginTop: 24 }}>批次列表</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>ID</th><th>商品</th><th>SKU</th><th>成本</th><th>零售价</th>
            <th>生产日期</th><th>保质期</th><th>到期日</th><th>最低毛利</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          {batches.map(b => (
            <tr key={b.id}>
              <td>{b.id}</td><td>{b.product_name}</td><td>{b.sku}</td>
              <td>¥{b.cost_price.toFixed(2)}</td><td>¥{b.retail_price.toFixed(2)}</td>
              <td>{b.production_date}</td><td>{b.shelf_life_days}天</td><td>{b.expiry_date}</td>
              <td>{(b.min_profit_rate * 100).toFixed(1)}%</td>
              <td><Badge {...STATUS_MAP[b.status]} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiscountPanel({ discounts, batches, pushAlert, loadData, user }) {
  const [selBatch, setSelBatch] = useState('');
  const [rate, setRate] = useState('');
  const [pubId, setPubId] = useState('');
  const [operator, setOperator] = useState('');

  const createDiscount = async () => {
    const res = await discountApi.create(parseInt(selBatch, 10), parseFloat(rate) / 100);
    if (res.ok) {
      pushAlert({ type: 'success', msg: `折扣创建成功，折后价 ¥${res.data.discounted_price}，毛利率 ${(res.data.gross_profit_rate * 100).toFixed(2)}%` });
      setSelBatch(''); setRate('');
      loadData();
    } else {
      pushAlert({ type: 'error', msg: res.msg, detail: res.detail });
    }
  };

  const publish = async () => {
    const res = await discountApi.publish(parseInt(pubId, 10), operator);
    if (res.ok) {
      pushAlert({ type: 'success', msg: `价签发布成功！编码: ${res.data.tag_code}，操作人: ${res.data.operator}` });
      setPubId(''); setOperator('');
      loadData();
    } else {
      pushAlert({ type: 'error', msg: res.msg, detail: res.detail });
    }
  };

  const revoke = async (id) => {
    const res = await discountApi.revoke(id);
    if (res.ok) { pushAlert({ type: 'success', msg: '已撤销发布' }); loadData(); }
    else { pushAlert({ type: 'error', msg: res.msg }); }
  };

  const activeBatches = batches.filter(b => b.status === 'active' || b.status === 'discounted');

  return (
    <div>
      <h3>创建折扣规则</h3>
      <div style={styles.formGrid}>
        <select value={selBatch} onChange={e => setSelBatch(e.target.value)} style={styles.input}>
          <option value="">选择批次</option>
          {activeBatches.map(b => (
            <option key={b.id} value={b.id}>
              {b.product_name}（到期:{b.expiry_date}）
            </option>
          ))}
        </select>
        <input placeholder="折扣率(% 如7折填70)" type="number" step="1" value={rate} onChange={e => setRate(e.target.value)} style={styles.input} />
        <button onClick={createDiscount} style={styles.btnPrimary}>创建折扣</button>
      </div>

      <h3 style={{ marginTop: 24 }}>发布价签</h3>
      <div style={styles.formGrid}>
        <select value={pubId} onChange={e => setPubId(e.target.value)} style={styles.input}>
          <option value="">选择折扣规则</option>
          {discounts.filter(d => d.status === 'draft').map(d => (
            <option key={d.id} value={d.id}>
              #{d.id} {d.product_name} {Math.round(d.discount_rate * 100)}%折 ¥{d.discounted_price}
            </option>
          ))}
        </select>
        <input placeholder="操作人" value={operator} onChange={e => setOperator(e.target.value)} style={styles.input} />
        <button onClick={publish} style={styles.btnPrimary}>发布价签</button>
      </div>

      <h3 style={{ marginTop: 24 }}>折扣规则列表</h3>
      <table style={styles.table}>
        <thead>
          <tr>
            <th>ID</th><th>商品</th><th>原价</th><th>折扣率</th><th>折后价</th>
            <th>毛利率</th><th>状态</th><th>操作人</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {discounts.map(d => (
            <tr key={d.id}>
              <td>{d.id}</td><td>{d.product_name}</td><td>¥{d.retail_price?.toFixed(2)}</td>
              <td>{Math.round(d.discount_rate * 100)}%</td><td>¥{d.discounted_price?.toFixed(2)}</td>
              <td>{(d.gross_profit_rate * 100).toFixed(2)}%</td>
              <td><Badge {...DISCOUNT_STATUS_MAP[d.status]} /></td>
              <td>{d.operator || '-'}</td>
              <td>
                {d.status === 'published' && (
                  <button onClick={() => revoke(d.id)} style={styles.btnSm}>撤销</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TagPanel({ tags }) {
  return (
    <div>
      <h3>价签发布记录</h3>
      <table style={styles.table}>
        <thead>
          <tr><th>ID</th><th>价签编码</th><th>商品</th><th>折扣</th><th>折后价</th><th>操作人</th><th>发布时间</th></tr>
        </thead>
        <tbody>
          {tags.map(t => (
            <tr key={t.id}>
              <td>{t.id}</td><td style={{ fontFamily: 'monospace' }}>{t.tag_code}</td>
              <td>{t.product_name}</td><td>{Math.round(t.discount_rate * 100)}%</td>
              <td>¥{t.discounted_price?.toFixed(2)}</td><td>{t.operator}</td><td>{t.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  loginWrap: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#f0f2f5' },
  loginCard: { background: '#fff', padding: 40, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.1)', width: 360 },
  app: { minHeight: '100vh', background: '#f0f2f5' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  nav: { display: 'flex', gap: 0, padding: '0 24px', background: '#fff', borderBottom: '1px solid #e8e8e8' },
  navBtn: { padding: '12px 24px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 500, borderBottom: '2px solid transparent' },
  navBtnActive: { borderBottom: '2px solid #1890ff', color: '#1890ff' },
  main: { padding: 24, maxWidth: 1200, margin: '0 auto' },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  btnPrimary: { padding: '8px 20px', background: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600, height: 38 },
  btnSm: { padding: '4px 12px', background: '#f5f5f5', border: '1px solid #d9d9d9', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  alertArea: { position: 'fixed', top: 16, right: 16, zIndex: 1000, width: 400 },
};
