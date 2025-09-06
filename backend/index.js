import { useState, useEffect, useRef } from 'react';
import { HomePage } from './components/HomePage';
import { useTelegram } from './src/utils/telegram'; // ✅ правильный путь (без ./src/)
import { AchievementsPage } from './components/AchievementsPageFixed';
import { TasksPage } from './components/TasksPage';
import { CasesPage } from './components/CasesPage';
import { ShopPageCasesStyleFixed } from './components/ShopPageCasesStyleFixed';
import { ProfilePage } from './components/ProfilePage';
import { BattlesPageExtended } from './components/BattlesPageExtended';
import { BattlesPageTest } from './components/BattlesPageTest';
import { BattlesPageMinimal } from './components/BattlesPageMinimal';
import { BackgroundFX } from './components/BackgroundFX';

import { SettingsModal } from './components/SettingsModal';
import { AdminPanel } from './components/AdminPanel';
import { Achievement } from './types/achievements';
import { ShopItem, Order } from './types/shop';
import { Task } from './types/tasks';
import { CaseType, UserCase } from './types/cases';
import { Notification } from './types/notifications';
import { Battle, BattleInvitation, User } from './types/battles';
import {
  mockShopItems,
  mockOrders,
  mockAchievements,
  mockTasks,
  mockCaseTypes,
  mockUserCases,
  mockNotifications,
  mockLeaderboard
} from './data/mockData';
import { LeaderboardEntry } from './types/global';

/** 
 * Отправка события/лога на бэкенд.
 * Использование: logEvent('open', 'app opened', { any: 'data' })
 */
export function logEvent(type: string, message?: string, extra?: any) {
  const token = localStorage.getItem('grither_token');
  if (!token) return;

  fetch(`${import.meta.env.VITE_API_BASE_URL}/api/logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({ type, message, extra })
  }).catch(() => {});
}

// ===== Утилиты localStorage =====
const getLocalStorageSize = () => {
  let total = 0;
  for (const key in localStorage) {
    if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
      total += (localStorage as any)[key]?.length + key.length;
    }
  }
  return total;
};

const cleanupLocalStorage = () => {
  const keysToRemove = ['oldCases', 'tempCases', 'backup_cases', 'cache_', 'temp_'];
  keysToRemove.forEach((keyPattern) => {
    Object.keys(localStorage).forEach((key) => {
      if (key.includes(keyPattern)) {
        localStorage.removeItem(key);
        console.log(`Удален ключ: ${key}`);
      }
    });
  });
};

export default function App() {
  // Telegram Web App integration
  const telegram = useTelegram();

  // ====== АВТОРИЗАЦИЯ ЧЕРЕЗ TELEGRAM WEB APP (один раз при монтировании) ======
  useEffect(() => {
    try {
      const wa = (window as any).Telegram?.WebApp;
      // аккуратно сообщаем Telegram, что WebApp готов
      wa?.ready?.();
      wa?.expand?.();

      const existing = localStorage.getItem('grither_token');
      if (existing) return;                 // уже есть токен
      if (!wa?.initData || wa.initData.length < 10) return; // не из TG WebApp

      fetch(`${import.meta.env.VITE_API_BASE_URL}/api/twa/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initData: wa.initData })
      })
        .then((r) => r.json())
        .then((r) => {
          if (r?.ok) {
            localStorage.setItem('grither_token', r.token);
            localStorage.setItem('grither_me', JSON.stringify(r.me));
            console.log('✅ auth ok', r.me);
            // первый лог «приложение открыто»
            logEvent('open', 'app opened');
          } else {
            console.warn('auth failed', r);
          }
        })
        .catch(console.error);
    } catch (e) {
      console.error(e);
    }
  }, []);
  // ============================================================================

  const [currentPage, setCurrentPage] = useState('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true); // По умолчанию тёмная тема
  const [hasAdminAccess, setHasAdminAccess] = useState(false); // Админ доступ выключен по умолчанию

  // Глобальные состояния
  const [achievements, setAchievements] = useState<Achievement[]>(mockAchievements);
  const [shopItems, setShopItems] = useState<ShopItem[]>(mockShopItems);
  const [orders, setOrders] = useState<Order[]>(mockOrders);
  const [tasks, setTasks] = useState<Task[]>(mockTasks);
  const [cases, setCases] = useState<CaseType[]>([]);
  const [userCases, setUserCases] = useState<UserCase[]>(mockUserCases);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [personalBattles, setPersonalBattles] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(mockNotifications);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(mockLeaderboard);

  const [battles, setBattles] = useState<Battle[]>([
    {
      id: 'battle1',
      challengerId: 'user1',
      challengerName: 'Анна Иванова',
      opponentId: 'current-user',
      opponentName: 'Вы',
      stake: 150,
      status: 'completed',
      startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      winnerId: 'user1',
      winnerName: 'Анна Иванова',
      loserId: 'current-user',
      loserName: 'Вы'
    },
    {
      id: 'battle2',
      challengerId: 'current-user',
      challengerName: 'Вы',
      opponentId: 'user3',
      opponentName: 'Мария Сидорова',
      stake: 200,
      status: 'completed',
      startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000 + 45 * 60 * 1000),
      winnerId: 'current-user',
      winnerName: 'Вы',
      loserId: 'user3',
      loserName: 'Мария Сидорова'
    },
    {
      id: 'battle3',
      challengerId: 'user4',
      challengerName: 'Алексей Козлов',
      opponentId: 'user2',
      opponentName: 'Петр Петров',
      stake: 100,
      status: 'completed',
      startedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 20 * 60 * 1000),
      winnerId: 'user4',
      winnerName: 'Алексей Козлов',
      loserId: 'user2',
      loserName: 'Петр Петров'
    },
    {
      id: 'battle4',
      challengerId: 'user5',
      challengerName: 'Елена Морозова',
      opponentId: 'current-user',
      opponentName: 'Вы',
      stake: 75,
      status: 'active',
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000)
    }
  ]);

  const [battleInvitations, setBattleInvitations] = useState<BattleInvitation[]>([
    {
      id: 'invitation1',
      challengerId: 'user3',
      challengerName: 'Мария Сидорова',
      opponentId: 'current-user',
      opponentName: 'Вы',
      stake: 120,
      message: 'Вызываю на реванш!',
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      expiresAt: new Date(Date.now() + 23.5 * 60 * 60 * 1000),
      status: 'pending'
    },
    {
      id: 'invitation2',
      challengerId: 'user1',
      challengerName: 'Анна Иванова',
      opponentId: 'current-user',
      opponentName: 'Вы',
      stake: 180,
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
      expiresAt: new Date(Date.now() + 23.8 * 60 * 60 * 1000),
      status: 'pending'
    }
  ]);

  // Инициализация пользователей с данными из Telegram
  const initializeUsers = () => {
    const currentUserData = {
      id: 'current-user',
      name: telegram.user
        ? `${telegram.user.first_name}${telegram.user.last_name ? ' ' + telegram.user.last_name : ''}`
        : 'Вы',
      level: 10,
      rating: 950,
      balance: 1500,
      isOnline: true,
      telegramId: telegram.user?.id || null,
      username: telegram.user?.username || null,
      avatar: telegram.user?.photo_url || null
    };

    return [
      currentUserData,
      { id: 'user1', name: 'Анна Иванова', level: 15, rating: 1250, balance: 2500, isOnline: true },
      { id: 'user2', name: 'Петр Петров', level: 12, rating: 980, balance: 1800, isOnline: false },
      { id: 'user3', name: 'Мария Сидорова', level: 18, rating: 1450, balance: 3200, isOnline: true },
      { id: 'user4', name: 'Алексей Козлов', level: 14, rating: 1120, balance: 2100, isOnline: true },
      { id: 'user5', name: 'Елена Морозова', level: 16, rating: 1380, balance: 2800, isOnline: false }
    ];
  };

  const [users, setUsers] = useState<User[]>(initializeUsers());

  // Флаг для отслеживания первой загрузки
  const casesInitialized = useRef(false);

  const handleNavigate = (page: string) => {
    if (page !== 'admin') setCurrentPage(page);
  };
  const handleOpenSettings = () => setSettingsOpen(true);
  const handleOpenAdminPanel = () => setCurrentPage('admin');
  const handleAdminNavigate = (page: string) => setCurrentPage(page);

  // ===== Уведомления
  const addNotification = (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => {
    const newNotification: Notification = {
      ...notification,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      read: false
    };
    setNotifications((prev) => [newNotification, ...prev]);
  };
  const markNotificationAsRead = (id: string) =>
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  const markAllNotificationsAsRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const removeNotification = (id: string) => setNotifications((prev) => prev.filter((n) => n.id !== id));
  const clearAllNotifications = () => setNotifications([]);

  // ===== Автоматические уведомления (обработчики) — без изменений твоей логики
  const handleAchievementUnlock = (achievement: Achievement) => {
    if (achievement.unlocked) {
      addNotification({
        type: 'achievement',
        title: '🏆 Достижение разблокировано!',
        message: `Поздравляем! Вы получили достижение "${achievement.title}". ${
          achievement.reward ? `Награда: ${achievement.reward} коинов.` : ''
        }`,
        priority: 'high',
        data: { achievementId: achievement.id, achievementTitle: achievement.title, reward: achievement.reward }
      });
      if (achievement.reward) updateUserBalance('current-user', achievement.reward);
    }
  };

  const handleNewTask = (task: Task) =>
    addNotification({
      type: 'task',
      title: '📋 Новая задача назначена!',
      message: `Вам назначена задача: "${task.title}". ${
        task.deadline ? `Крайний срок: ${new Date(task.deadline).toLocaleDateString()}` : 'Выполните в удобное время.'
      }`,
      priority: task.priority === 'high' ? 'high' : 'medium',
      data: { taskId: task.id, taskTitle: task.title, deadline: task.deadline, reward: task.reward }
    });

  const handleTaskCompletion = (task: Task) => {
    if (task.completed) {
      addNotification({
        type: 'task',
        title: '✅ Задача выполнена!',
        message: `Задача "${task.title}" успешно выполнена! ${
          task.reward ? `Получено: ${task.reward} коинов и ${task.experience || 50} опыта.` : 'Отличная работа!'
        }`,
        priority: 'medium',
        data: { taskId: task.id, taskTitle: task.title, reward: task.reward, experience: task.experience }
      });
      if (task.reward) updateUserBalance('current-user', task.reward);
      if (task.experience) updateUserExperience('current-user', task.experience);
    }
  };

  const handleNewShopItem = (item: ShopItem) =>
    addNotification({
      type: 'shop',
      title: '🛍️ Новый товар в магазине!',
      message: `Добавлен новый товар: "${item.title}". ${
        item.sale ? `🔥 Скидка ${item.sale}%!` : `Цена: ${item.price} коинов.`
      }`,
      priority: item.sale ? 'high' : 'medium',
      data: { itemId: item.id, itemTitle: item.title, price: item.price, sale: item.sale }
    });

  const handleShopItemSale = (item: ShopItem, oldPrice: number) => {
    if (item.sale && item.sale > 0) {
      const salePrice = item.price * (1 - item.sale / 100);
      addNotification({
        type: 'shop',
        title: '🔥 Скидка на товар!',
        message: `Скидка ${item.sale}% на "${item.title}"! Цена: ${Math.round(salePrice)} коинов (было ${oldPrice}).`,
        priority: 'high',
        data: { itemId: item.id, itemTitle: item.title, oldPrice, newPrice: salePrice, salePercent: item.sale }
      });
    }
  };

  const handleOrderApproval = (order: Order) => {
    if (order.status === 'approved') {
      addNotification({
        type: 'shop',
        title: '✅ Покупка одобрена!',
        message: `Ваш заказ "${order.itemTitle}" одобрен администратором. Ожидайте выполнения заказа.`,
        priority: 'medium',
        data: { orderId: order.id, itemTitle: order.itemTitle, totalPrice: order.totalPrice }
      });
    } else if (order.status === 'rejected') {
      addNotification({
        type: 'shop',
        title: '❌ Покупка отклонена',
        message: `Ваш заказ "${order.itemTitle}" отклонен. Средства возвращены на баланс.`,
        priority: 'medium',
        data: { orderId: order.id, itemTitle: order.itemTitle, refundAmount: order.totalPrice }
      });
      updateUserBalance('current-user', order.totalPrice);
    }
  };

  const handleNewCase = (caseItem: CaseType) =>
    addNotification({
      type: 'case',
      title: '📦 Новый кейс добавлен!',
      message: `Добавлен новый кейс: "${caseItem.name}". Цена: ${caseItem.price} коинов. Попробуйте свою удачу!`,
      priority: 'medium',
      data: { caseId: caseItem.id, caseName: caseItem.name, price: caseItem.price }
    });

  const handleCaseOpening = (caseItem: CaseType, prize: any) =>
    addNotification({
      type: 'case',
      title: '🎁 Кейс открыт!',
      message: `Из кейса "${caseItem.name}" выпал приз: "${prize.name}"! ${
        prize.type === 'coins' ? `Получено: ${prize.value} коинов.` : `Редкость: ${prize.rarity}.`
      }`,
      priority: prize.rarity === 'legendary' ? 'high' : 'medium',
      data: {
        caseId: caseItem.id,
        caseName: caseItem.name,
        prizeName: prize.name,
        prizeType: prize.type,
        prizeValue: prize.value,
        rarity: prize.rarity
      }
    });

  const handleAdminResponse = (message: string, type: 'approval' | 'rejection' | 'info' = 'info') =>
    addNotification({
      type: 'admin',
      title:
        type === 'approval'
          ? '✅ Ответ администратора'
          : type === 'rejection'
          ? '❌ Ответ администратора'
          : '💬 Сообщение от администратора',
      message,
      priority: type === 'approval' || type === 'rejection' ? 'high' : 'medium',
      data: { responseType: type, timestamp: new Date() }
    });

  const handleSystemUpdate = (version: string) =>
    addNotification({
      type: 'system',
      title: '🚀 Обновление системы',
      message: `GRITHER обновлен до версии ${version}. Улучшена производительность и добавлены новые функции!`,
      priority: 'medium',
      data: { version, updateType: 'system' }
    });

  const handleMaintenanceNotification = (startTime: Date, duration: string) =>
    addNotification({
      type: 'system',
      title: '🔧 Плановые техработы',
      message: `Плановые техработы начнутся ${startTime.toLocaleString()}. Продолжительность: ${duration}. Система может быть недоступна.`,
      priority: 'high',
      data: { startTime, duration, maintenanceType: 'planned' }
    });

  const handleLeaderboardUpdate = (position: number, previousPosition?: number) => {
    if (previousPosition && position < previousPosition) {
      addNotification({
        type: 'achievement',
        title: '📈 Рост в рейтинге!',
        message: `Поздравляем! Вы поднялись в рейтинге с ${previousPosition} на ${position} место!`,
        priority: 'medium',
        data: { newPosition: position, previousPosition, improvement: previousPosition - position }
      });
    }
  };

  const handleWeeklyChallenge = (challengeName: string, reward: number) =>
    addNotification({
      type: 'challenge',
      title: '🏆 Новый еженедельный челлендж!',
      message: `Стартовал новый челлендж: "${challengeName}". Награда победителю: ${reward} коинов!`,
      priority: 'high',
      data: { challengeName, reward, challengeType: 'weekly' }
    });

  const handleSpecialEvent = (eventName: string, description: string) =>
    addNotification({
      type: 'event',
      title: '🎉 Специальное событие!',
      message: `${eventName}: ${description}`,
      priority: 'high',
      data: { eventName, description, eventType: 'special' }
    });

  // ===== Баттлы
  const createBattleInvitation = (inv: Omit<BattleInvitation, 'id' | 'createdAt' | 'expiresAt' | 'status'>) => {
    const challengerBalance = getUserBalance(inv.challengerId);
    if (challengerBalance < inv.stake) {
      addNotification({
        type: 'error',
        title: 'Недостаточно средств!',
        message: `У вас недостаточно коинов для создания баттла. Требуется: ${inv.stake}, у вас: ${challengerBalance}`,
        priority: 'high'
      });
      return;
    }
    const opponentBalance = getUserBalance(inv.opponentId);
    if (opponentBalance < inv.stake) {
      addNotification({
        type: 'error',
        title: 'Невозможно создать баттл!',
        message: `У ${inv.opponentName} недостаточно коинов для участия в баттле.`,
        priority: 'medium'
      });
      return;
    }
    const newInvitation: BattleInvitation = {
      ...inv,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      status: 'pending'
    };
    setBattleInvitations((prev) => [newInvitation, ...prev]);
    addNotification({
      type: 'battle',
      title: 'Новый вызов на баттл!',
      message: `${inv.challengerName} вызывает вас на баттл. Ставка: ${inv.stake} коинов.`,
      priority: 'high',
      data: { invitationId: newInvitation.id, stake: inv.stake }
    });
  };

  const acceptBattleInvitation = (invitationId: string) => {
    const invitation = battleInvitations.find((inv) => inv.id === invitationId);
    if (!invitation) return;

    const opponentBalance = getUserBalance(invitation.opponentId);
    if (opponentBalance < invitation.stake) {
      addNotification({
        type: 'error',
        title: 'Недостаточно средств!',
        message: `У вас недостаточно коинов для участия в баттле. Требуется: ${invitation.stake}, у вас: ${opponentBalance}`,
        priority: 'high'
      });
      return;
    }
    const challengerBalance = getUserBalance(invitation.challengerId);
    if (challengerBalance < invitation.stake) {
      addNotification({
        type: 'error',
        title: 'Баттл отменен!',
        message: `У ${invitation.challengerName} недостаточно коинов для продолжения баттла.`,
        priority: 'medium'
      });
      setBattleInvitations((prev) =>
        prev.map((inv) => (inv.id === invitationId ? { ...inv, status: 'declined' as const } : inv))
      );
      return;
    }

    setBattleInvitations((prev) =>
      prev.map((inv) => (inv.id === invitationId ? { ...inv, status: 'accepted' as const } : inv))
    );

    const newBattle: Battle = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      challengerId: invitation.challengerId,
      challengerName: invitation.challengerName,
      opponentId: invitation.opponentId,
      opponentName: invitation.opponentName,
      stake: invitation.stake,
      status: 'active',
      startedAt: new Date()
    };
    setBattles((prev) => [newBattle, ...prev]);

    addNotification({
      type: 'battle',
      title: 'Вызов принят!',
      message: `${invitation.opponentName} принял ваш вызов на баттл. Ставка: ${invitation.stake} коинов.`,
      priority: 'medium',
      data: { battleId: newBattle.id }
    });
  };

  const declineBattleInvitation = (invitationId: string) => {
    const invitation = battleInvitations.find((inv) => inv.id === invitationId);
    if (!invitation) return;
    setBattleInvitations((prev) =>
      prev.map((inv) => (inv.id === invitationId ? { ...inv, status: 'declined' as const } : inv))
    );
    addNotification({
      type: 'battle',
      title: 'Вызов отклонен',
      message: `${invitation.opponentName} отклонил ваш вызов на баттл.`,
      priority: 'low',
      data: { invitationId }
    });
  };

  // ===== Баланс/Опыт
  const updateUserBalance = (userId: string, amount: number) => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, balance: Math.max(0, u.balance + amount) } : u)));
  };

  const updateUserExperience = (userId: string, amount: number) => {
    setUsers((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const oldLevel = u.level;
        const newExperience = Math.max(0, (u.experience || 0) + amount);
        const newLevel = u.level + Math.floor(newExperience / 1000) - Math.floor((u.experience || 0) / 1000);

        if (newLevel > oldLevel && userId === 'current-user') {
          addNotification({
            type: 'achievement',
            title: '🎉 Новый уровень!',
            message: `Поздравляем! Вы достигли ${newLevel} уровня. Получено: ${(newLevel - oldLevel) * 100} коинов бонуса!`,
            priority: 'high',
            data: { oldLevel, newLevel, bonusCoins: (newLevel - oldLevel) * 100 }
          });
          updateUserBalance(userId, (newLevel - oldLevel) * 100);
        }
        return { ...u, experience: newExperience, level: newLevel };
      })
    );
  };

  const getUserBalance = (userId: string) => users.find((u) => u.id === userId)?.balance || 0;

  const completeBattle = (battleId: string, winnerId: string) => {
    const battle = battles.find((b) => b.id === battleId);
    if (!battle) return;

    const winnerName = winnerId === battle.challengerId ? battle.challengerName : battle.opponentName;
    const loserName = winnerId === battle.challengerId ? battle.opponentName : battle.challengerName;
    const loserId = winnerId === battle.challengerId ? battle.opponentId : battle.challengerId;

    updateUserBalance(winnerId, battle.stake);
    updateUserBalance(loserId, -battle.stake);

    setBattles((prev) =>
      prev.map((b) =>
        b.id === battleId
          ? {
              ...b,
              status: 'completed' as const,
              completedAt: new Date(),
              winnerId,
              winnerName,
              loserId,
              loserName
            }
          : b
      )
    );

    if (winnerId === 'current-user') {
      addNotification({
        type: 'battle',
        title: '🎉 Баттл выигран!',
        message: `Поздравляем! Вы победили в баттле против ${loserName}. Получено: ${battle.stake} коинов.`,
        priority: 'high',
        data: { battleId, winnerId, stake: battle.stake, result: 'victory' }
      });
    } else if (loserId === 'current-user') {
      addNotification({
        type: 'battle',
        title: '😔 Баттл проигран',
        message: `Баттл против ${winnerName} завершился поражением. Потеряно: ${battle.stake} коинов.`,
        priority: 'medium',
        data: { battleId, winnerId, stake: battle.stake, result: 'defeat' }
      });
    } else {
      addNotification({
        type: 'battle',
        title: '⚔️ Баттл завершен',
        message: `Баттл завершен! Победитель: ${winnerName}, проигравший: ${loserName}. Ставка: ${battle.stake} коинов.`,
        priority: 'low',
        data: { battleId, winnerId, stake: battle.stake, result: 'spectator' }
      });
    }
  };

  const handleToggleDarkMode = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  // Тема и meta viewport
  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');

    let viewport = document.querySelector("meta[name=viewport]");
    if (!viewport) {
      viewport = document.createElement('meta');
      viewport.setAttribute('name', 'viewport');
      document.head.appendChild(viewport);
    }
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  }, [isDarkMode]);

  // Тема из Telegram или localStorage + контроль объема localStorage
  useEffect(() => {
    if (telegram.isAvailable) {
      const telegramThemeIsDark = telegram.colorScheme === 'dark';
      setIsDarkMode(telegramThemeIsDark);
      localStorage.setItem('theme', telegramThemeIsDark ? 'dark' : 'light');
      console.log('🎨 Тема синхронизирована с Telegram:', telegram.colorScheme);
    } else {
      const savedTheme = localStorage.getItem('theme');
      setIsDarkMode(savedTheme === 'light' ? false : true);
    }

    const totalSize = getLocalStorageSize();
    console.log(`Общий размер localStorage: ${(totalSize / 1024).toFixed(2)} KB`);
    if (totalSize > 8 * 1024 * 1024) {
      console.warn('localStorage близок к переполнению, выполняем очистку');
      cleanupLocalStorage();
    }
  }, []);

  // Загрузка кейсов
  useEffect(() => {
    const savedCases = localStorage.getItem('cases');
    if (savedCases) {
      try {
        const parsedCases = JSON.parse(savedCases);
        const merged = parsedCases.map((saved: any) => {
          const mockCase = mockCaseTypes.find((m) => m.id === saved.id);
          if (mockCase) {
            return {
              ...saved,
              image: saved.image || mockCase.image,
              prizes: saved.prizes.map((sp: any) => {
                const mp = mockCase.prizes.find((p) => p.id === sp.id);
                return { ...sp, image: sp.image || (mp ? mp.image : sp.image) };
              })
            };
          }
          return saved;
        });
        setCases(merged);
      } catch (e) {
        console.error('Ошибка при загрузке кейсов:', e);
        setCases(mockCaseTypes);
      }
    } else {
      setCases(mockCaseTypes);
    }
    casesInitialized.current = true;
  }, []);

  // Сохранение кейсов
  useEffect(() => {
    if (!casesInitialized.current || cases.length === 0) return;
    try {
      const casesToSave = cases.map((c) => {
        const isBase64Image = c.image && c.image.startsWith('data:');
        return {
          ...c,
          image: isBase64Image ? null : c.image,
          prizes: c.prizes.map((p) => ({
            ...p,
            image: p.image && p.image.startsWith('data:') ? null : p.image
          }))
        };
      });
      const dataToSave = JSON.stringify(casesToSave);
      const dataSize = new Blob([dataToSave]).size;
      console.log(`Размер данных кейсов: ${(dataSize / 1024).toFixed(2)} KB`);
      if (dataSize > 4 * 1024 * 1024) {
        console.warn('Данные кейсов слишком большие для localStorage');
        return;
      }
      localStorage.setItem('cases', dataToSave);
    } catch (e: any) {
      console.error('Ошибка при сохранении кейсов:', e);
      if (e?.name === 'QuotaExceededError') {
        console.warn('localStorage переполнен, удаляем старые данные кейсов');
        try {
          localStorage.removeItem('cases');
          ['oldCases', 'tempCases', 'backup_cases'].forEach((k) => localStorage.removeItem(k));
        } catch (cleanupError) {
          console.error('Ошибка при очистке localStorage:', cleanupError);
        }
      }
    }
  }, [cases]);

  // Пользовательские кейсы: загрузка и сохранение
  useEffect(() => {
    const savedUserCases = localStorage.getItem('userCases');
    if (savedUserCases) {
      try {
        const parsed = JSON.parse(savedUserCases, (key, value) => (key === 'obtainedAt' ? new Date(value) : value));
        setUserCases(parsed);
      } catch (e) {
        console.error('Ошибка при загрузке пользовательских кейсов:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (userCases.length > 0 || localStorage.getItem('userCases')) {
      try {
        const dataToSave = JSON.stringify(userCases);
        const size = new Blob([dataToSave]).size;
        if (size > 2 * 1024 * 1024) {
          console.warn('Данные пользовательских кейсов слишком большие');
          const trimmed = userCases.slice(-50);
          localStorage.setItem('userCases', JSON.stringify(trimmed));
          if (trimmed.length !== userCases.length) setUserCases(trimmed);
        } else {
          localStorage.setItem('userCases', dataToSave);
        }
      } catch (e: any) {
        console.error('Ошибка при сохранении пользовательских кейсов:', e);
        if (e?.name === 'QuotaExceededError') {
          try {
            const trimmed = userCases.slice(-20);
            localStorage.setItem('userCases', JSON.stringify(trimmed));
            setUserCases(trimmed);
            console.log('Сохранены только последние 20 пользовательских кейсов');
          } catch (trimError) {
            console.error('Не удалось сохранить даже урезанные данные:', trimError);
            localStorage.removeItem('userCases');
          }
        }
      }
    }
  }, [userCases]);

  // Персональные баттлы
  useEffect(() => {
    const saved = localStorage.getItem('personalBattles');
    if (saved) {
      try {
        const parsed = JSON.parse(saved, (k, v) => (k === 'endDate' || k === 'created' ? new Date(v) : v));
        setPersonalBattles(parsed);
      } catch (e) {
        console.error('Ошибка при загрузке персональных баттлов:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (personalBattles.length > 0 || localStorage.getItem('personalBattles')) {
      try {
        localStorage.setItem('personalBattles', JSON.stringify(personalBattles));
      } catch (e) {
        console.error('Ошибка при сохранении персональных баттлов:', e);
      }
    }
  }, [personalBattles]);

  // Уведомления: загрузка/сохранение + мотивация
  useEffect(() => {
    const saved = localStorage.getItem('notifications');
    if (saved) {
      try {
        const parsed = JSON.parse(saved, (k, v) => (k === 'timestamp' ? new Date(v) : v));
        setNotifications(parsed);
      } catch (e) {
        console.error('Ошибка при загрузке уведомлений:', e);
      }
    }

    const hasWelcome = localStorage.getItem('hasWelcomeNotification');
    if (!hasWelcome) {
      setTimeout(() => {
        const welcome: Notification = {
          id: 'welcome_' + Date.now().toString(),
          type: 'system',
          title: 'Добро пожаловать в GRITHER!',
          message:
            'Здесь вы будете получать уведомления о новых задачах, достижениях, баттлах и многом другом.',
          priority: 'medium',
          timestamp: new Date(),
          read: false
        };
        setNotifications((prev) => [welcome, ...prev]);
        localStorage.setItem('hasWelcomeNotification', 'true');
      }, 2000);
    }

    const setupPeriodic = () => {
      const lastDaily = localStorage.getItem('lastDailyMotivation');
      const now = Date.now();
      if (!lastDaily || now - parseInt(lastDaily) > 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          const messages = [
            'Время покорять новые вершины! Проверьте новые задачи и достижения.',
            'Ваши коллеги уже активны сегодня. Не отставайте!',
            'Новый день - новые возможности заработать больше коинов!',
            'Проверьте магазин - возможно, появились новые товары!',
            'Время для нового баттла? Вызовите коллег на соревнование!'
          ];
          const msg = messages[Math.floor(Math.random() * messages.length)];
          addNotification({ type: 'system', title: '🌟 Ежедневная мотивация', message: msg, priority: 'low' });
          localStorage.setItem('lastDailyMotivation', now.toString());
        }, 30000);
      }

      setTimeout(() => {
        const incomplete = tasks.filter((t) => !t.completed && t.deadline);
        const urgent = incomplete.filter((t) => {
          if (!t.deadline) return false;
          const deadline = new Date(t.deadline).getTime();
          const timeLeft = deadline - now;
          return timeLeft > 0 && timeLeft < 24 * 60 * 60 * 1000;
        });
        if (urgent.length > 0) {
          addNotification({
            type: 'task',
            title: '⏰ Срочные задачи!',
            message: `У вас ${urgent.length} задач с дедлайном менее чем через 24 часа. Не забудьте их выполнить!`,
            priority: 'high',
            data: { urgentTasksCount: urgent.length }
          });
        }
      }, 60000);
    };
    setupPeriodic();
  }, []);

  // Telegram данные в профиль
  useEffect(() => {
    if (telegram.isAvailable && telegram.user) {
      console.log('📱 Telegram Web App инициализирован:', {
        user: telegram.user,
        platform: telegram.platform,
        colorScheme: telegram.colorScheme
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.id === 'current-user'
            ? {
                ...u,
                name: `${telegram.user!.first_name}${telegram.user!.last_name ? ' ' + telegram.user!.last_name : ''}`,
                telegramId: telegram.user!.id,
                username: telegram.user!.username || null,
                avatar: telegram.user!.photo_url || null
              }
            : u
        )
      );

      setTimeout(() => {
        addNotification({
          type: 'system',
          title: '👋 Добро пожаловать!',
          message: `Привет, ${telegram.user!.first_name}! Добро пожаловать в GRITHER через Telegram!`,
          priority: 'medium'
        });
      }, 3000);

      telegram.impactFeedback('light');
    } else {
      console.log('🌐 Запуск в браузере (без Telegram Web App)');
    }
  }, [telegram.isAvailable, telegram.user]);

  // Уведомления: сохранение
  useEffect(() => {
    if (notifications.length > 0 || localStorage.getItem('notifications')) {
      try {
        const toSave = notifications.slice(0, 100);
        localStorage.setItem('notifications', JSON.stringify(toSave));
      } catch (e: any) {
        console.error('Ошибка при сохранении уведомлений:', e);
        if (e?.name === 'QuotaExceededError') {
          try {
            const trimmed = notifications.slice(0, 50);
            localStorage.setItem('notifications', JSON.stringify(trimmed));
            setNotifications(trimmed);
          } catch (trimError) {
            console.error('Не удалось сохранить даже урезанные уведомления:', trimError);
            localStorage.removeItem('notifications');
          }
        }
      }
    }
  }, [notifications]);

  // Пользователи: загрузка/сохранение
  useEffect(() => {
    const saved = localStorage.getItem('users');
    if (saved) {
      try {
        setUsers(JSON.parse(saved));
      } catch (e) {
        console.error('Ошибка при загрузке пользователей:', e);
      }
    }
  }, []);

  useEffect(() => {
    if (users.length > 0) {
      try {
        localStorage.setItem('users', JSON.stringify(users));
      } catch (e) {
        console.error('Ошибка при сохранении пользователей:', e);
      }
    }
  }, [users]);

  // Трекинг изменений (достижения/задачи/товары/заказы/кейсы/открытия)
  const prevAchievements = useRef<Achievement[]>([]);
  useEffect(() => {
    if (prevAchievements.current.length > 0) {
      achievements.forEach((a) => {
        const prev = prevAchievements.current.find((x) => x.id === a.id);
        if (prev && !prev.unlocked && a.unlocked) handleAchievementUnlock(a);
      });
    }
    prevAchievements.current = [...achievements];
  }, [achievements]);

  const prevTasks = useRef<Task[]>([]);
  useEffect(() => {
    if (prevTasks.current.length > 0) {
      tasks.forEach((t) => {
        const prev = prevTasks.current.find((x) => x.id === t.id);
        if (!prev) handleNewTask(t);
        else if (!prev.completed && t.completed) handleTaskCompletion(t);
      });
    }
    prevTasks.current = [...tasks];
  }, [tasks]);

  const prevShopItems = useRef<ShopItem[]>([]);
  useEffect(() => {
    if (prevShopItems.current.length > 0) {
      shopItems.forEach((i) => {
        const prev = prevShopItems.current.find((x) => x.id === i.id);
        if (!prev) handleNewShopItem(i);
        else if (i.sale && (!prev.sale || prev.sale !== i.sale)) handleShopItemSale(i, prev.price);
      });
    }
    prevShopItems.current = [...shopItems];
  }, [shopItems]);

  const prevOrders = useRef<Order[]>([]);
  useEffect(() => {
    if (prevOrders.current.length > 0) {
      orders.forEach((o) => {
        const prev = prevOrders.current.find((x) => x.id === o.id);
        if (prev && prev.status !== o.status && (o.status === 'approved' || o.status === 'rejected')) {
          handleOrderApproval(o);
        }
      });
    }
    prevOrders.current = [...orders];
  }, [orders]);

  const prevCases = useRef<CaseType[]>([]);
  useEffect(() => {
    if (prevCases.current.length > 0) {
      cases.forEach((c) => {
        const prev = prevCases.current.find((x) => x.id === c.id);
        if (!prev) handleNewCase(c);
      });
    }
    prevCases.current = [...cases];
  }, [cases]);

  const prevUserCases = useRef<UserCase[]>([]);
  useEffect(() => {
    if (prevUserCases.current.length > 0) {
      userCases.forEach((uc) => {
        const prev = prevUserCases.current.find((x) => x.id === uc.id);
        if (!prev) {
          const caseItem = cases.find((c) => c.id === uc.caseId);
          if (caseItem && uc.prize) handleCaseOpening(caseItem, uc.prize);
        }
      });
    }
    prevUserCases.current = [...userCases];
  }, [userCases]);

  // Секретная комбинация для админки: admin
  useEffect(() => {
    let sequence = '';
    const secretCode = 'admin';
    let isProcessingSecret = false;

    const handleKeyPress = (e: KeyboardEvent) => {
      if (isProcessingSecret) return;
      sequence += e.key.toLowerCase();
      if (sequence.length > secretCode.length) sequence = sequence.slice(-secretCode.length);
      if (sequence === secretCode) {
        isProcessingSecret = true;
        setCurrentPage('admin');
        sequence = '';
        setTimeout(() => {
          isProcessingSecret = false;
        }, 1000);
      }
    };

    document.addEventListener('keypress', handleKeyPress);
    return () => document.removeEventListener('keypress', handleKeyPress);
  }, []);

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'achievements':
        return (
          <AchievementsPage
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            achievements={achievements}
            setAchievements={setAchievements}
            profilePhoto={profilePhoto}
            theme={isDarkMode ? 'dark' : 'light'}
            notifications={notifications}
            onMarkNotificationAsRead={markNotificationAsRead}
            onMarkAllNotificationsAsRead={markAllNotificationsAsRead}
            onRemoveNotification={removeNotification}
            onClearAllNotifications={clearAllNotifications}
            addNotification={addNotification}
          />
        );
      case 'tasks':
        return (
          <TasksPage
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            profilePhoto={profilePhoto}
            tasks={tasks}
            setTasks={setTasks}
            theme={isDarkMode ? 'dark' : 'light'}
            addNotification={addNotification}
          />
        );
      case 'cases':
        return (
          <CasesPage
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            profilePhoto={profilePhoto}
            theme={isDarkMode ? 'dark' : 'light'}
            cases={cases}
            setCases={setCases}
            userCases={userCases}
            setUserCases={setUserCases}
            currentUser={users.find((u) => u.id === 'current-user')}
            onUpdateUserBalance={updateUserBalance}
            onUpdateUserExperience={updateUserExperience}
            addNotification={addNotification}
          />
        );
      case 'shop':
        return (
          <ShopPageCasesStyleFixed
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            profilePhoto={profilePhoto}
            shopItems={shopItems}
            setShopItems={setShopItems}
            orders={orders}
            setOrders={setOrders}
            theme={isDarkMode ? 'dark' : 'light'}
            currentUser={users.find((u) => u.id === 'current-user')}
            onUpdateUserBalance={updateUserBalance}
            addNotification={addNotification}
          />
        );
      case 'profile':
        return (
          <ProfilePage
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            profilePhoto={profilePhoto}
            setProfilePhoto={setProfilePhoto}
            theme={isDarkMode ? 'dark' : 'light'}
            battles={battles}
            battleInvitations={battleInvitations}
            personalBattles={personalBattles}
            users={users}
            currentUser={users.find((u) => u.id === 'current-user')}
          />
        );
      case 'battles':
        return (
          <BattlesPageExtended
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            profilePhoto={profilePhoto}
            personalBattles={personalBattles}
            setPersonalBattles={setPersonalBattles}
            theme={isDarkMode ? 'dark' : 'light'}
            notifications={notifications}
            onMarkNotificationAsRead={markNotificationAsRead}
            onMarkAllNotificationsAsRead={markAllNotificationsAsRead}
            onRemoveNotification={removeNotification}
            onClearAllNotifications={clearAllNotifications}
            addNotification={addNotification}
          />
        );
      case 'admin':
        return (
          <AdminPanel
            onNavigate={handleAdminNavigate}
            achievements={achievements}
            setAchievements={setAchievements}
            shopItems={shopItems}
            setShopItems={setShopItems}
            orders={orders}
            setOrders={setOrders}
            tasks={tasks}
            setTasks={setTasks}
            cases={cases}
            setCases={setCases}
            userCases={userCases}
            setUserCases={setUserCases}
            onToggleDarkMode={handleToggleDarkMode}
            battles={battles}
            setBattles={setBattles}
            battleInvitations={battleInvitations}
            setBattleInvitations={setBattleInvitations}
            onCompleteBattle={completeBattle}
            users={users}
            onUpdateUserBalance={updateUserBalance}
            addNotification={addNotification}
          />
        );
      case 'home':
      default:
        return (
          <HomePage
            onNavigate={handleNavigate}
            currentPage={currentPage}
            onOpenSettings={handleOpenSettings}
            achievements={achievements}
            profilePhoto={profilePhoto}
            personalBattles={personalBattles}
            setPersonalBattles={setPersonalBattles}
            theme={isDarkMode ? 'dark' : 'light'}
            notifications={notifications}
            onMarkNotificationAsRead={markNotificationAsRead}
            onMarkAllNotificationsAsRead={markAllNotificationsAsRead}
            onRemoveNotification={removeNotification}
            onClearAllNotifications={clearAllNotifications}
            addNotification={addNotification}
            battles={battles}
            battleInvitations={battleInvitations}
            users={users}
            leaderboard={mockLeaderboard}
            onCreateBattleInvitation={createBattleInvitation}
            onAcceptBattleInvitation={acceptBattleInvitation}
            onDeclineBattleInvitation={declineBattleInvitation}
            onCompleteBattle={completeBattle}
            currentUser={users.find((u) => u.id === 'current-user')}
          />
        );
    }
  };

  return (
    <>
      {/* Фон */}
      <BackgroundFX variant="spotlight+grain+vignette" theme={isDarkMode ? 'dark' : 'light'} />

      {/* Контент */}
      <div className="page-content" style={{ position: 'relative', zIndex: 10, minHeight: '100vh' }}>
        {renderCurrentPage()}
      </div>

      {/* Настройки */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isDarkMode={isDarkMode}
        onToggleDarkMode={handleToggleDarkMode}
        onOpenAdminPanel={handleOpenAdminPanel}
        hasAdminAccess={hasAdminAccess}
        setHasAdminAccess={setHasAdminAccess}
        theme={isDarkMode ? 'dark' : 'light'}
      />
    </>
  );
}
