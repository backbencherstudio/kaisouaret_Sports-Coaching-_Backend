import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import appConfig from '../../config/app.config';

/**
 * Notification Types Enum
 */
export enum NotificationType {
  // Auth & Account
  USER_REGISTERED = 'user_registered',
  USER_LOGGED_IN = 'user_logged_in',
  EMAIL_VERIFIED = 'email_verified',
  ACCOUNT_UPDATED = 'account_updated',
  PASSWORD_CHANGED = 'password_changed',

  // Bookings
  BOOKING_CREATED = 'booking_created',
  BOOKING_CONFIRMED = 'booking_confirmed',
  BOOKING_CANCELLED = 'booking_cancelled',
  BOOKING_COMPLETED = 'booking_completed',
  BOOKING_REMINDER_24H = 'booking_reminder_24h',
  BOOKING_REMINDER_1H = 'booking_reminder_1h',
  BOOKING_RESCHEDULED = 'booking_rescheduled',

  // Payments
  PAYMENT_INITIATED = 'payment_initiated',
  PAYMENT_SUCCESSFUL = 'payment_successful',
  PAYMENT_FAILED = 'payment_failed',
  PAYMENT_REFUNDED = 'payment_refunded',
  INVOICE_GENERATED = 'invoice_generated',
  SUBSCRIPTION_STARTED = 'subscription_started',
  SUBSCRIPTION_RENEWED = 'subscription_renewed',
  SUBSCRIPTION_EXPIRING_SOON = 'subscription_expiring_soon',
  SUBSCRIPTION_EXPIRED = 'subscription_expired',

  // Reviews
  REVIEW_RECEIVED = 'review_received',
  REVIEW_PUBLISHED = 'review_published',
  REVIEW_RATING_IMPROVED = 'review_rating_improved',

  // Goals
  GOAL_CREATED = 'goal_created',
  GOAL_PROGRESS_25 = 'goal_progress_25',
  GOAL_PROGRESS_50 = 'goal_progress_50',
  GOAL_PROGRESS_75 = 'goal_progress_75',
  GOAL_COMPLETED = 'goal_completed',
  GOAL_DEADLINE_APPROACHING = 'goal_deadline_approaching',
  GOAL_COACH_ASSIGNED = 'goal_coach_assigned',
  COACH_NOTE_ADDED = 'coach_note_added',

  // Coach Profile
  COACH_PROFILE_VERIFIED = 'coach_profile_verified',
  COACH_PROFILE_REJECTION = 'coach_profile_rejection',
  COACH_REGISTRATION_FEE_PAID = 'coach_registration_fee_paid',

  // Video Community
  VIDEO_UPLOADED = 'video_uploaded',
  VIDEO_PUBLISHED = 'video_published',
  VIDEO_COMMENT = 'video_comment',

  // Chat
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_REQUEST = 'message_request',

  // Badges
  BADGE_EARNED = 'badge_earned',
  BADGE_MILESTONE = 'badge_milestone',

  // Custom Offers
  CUSTOM_OFFER_RECEIVED = 'custom_offer_received',
  CUSTOM_OFFER_ACCEPTED = 'custom_offer_accepted',
  CUSTOM_OFFER_DECLINED = 'custom_offer_declined',

  // Sessions & Packages
  SESSION_PACKAGE_PURCHASED = 'session_package_purchased',
  SESSION_COMPLETED = 'session_completed',
  SESSIONS_REMAINING_5 = 'sessions_remaining_5',
  SESSIONS_EXPIRED = 'sessions_expired',

  // Admin
  NEW_COACH_APPLICATION = 'new_coach_application',
  CONTACT_FORM_SUBMITTED = 'contact_form_submitted',
}

/**
 * Notification Priority Enum
 */
export enum NotificationPriority {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/**
 * Notification Template Interface
 */
interface NotificationTemplate {
  type: NotificationType;
  subject?: string;
  text: string;
  priority: NotificationPriority;
  channels: ('in_app' | 'email' | 'push' | 'sms')[];
  variables: string[];
}

/**
 * Notification Templates
 */
const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> =
  {
    // Auth & Account
    [NotificationType.USER_REGISTERED]: {
      type: NotificationType.USER_REGISTERED,
      subject: 'Welcome to {{platform_name}}!',
      text: 'Hi {{user_name}}, welcome! Your account has been created successfully. Verify your email to get started.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'platform_name'],
    },
    [NotificationType.USER_LOGGED_IN]: {
      type: NotificationType.USER_LOGGED_IN,
      subject: 'Login Successful',
      text: 'Hi {{user_name}}, you have logged in successfully on {{login_time}}.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app'],
      variables: ['user_name', 'login_time'],
    },
    [NotificationType.EMAIL_VERIFIED]: {
      type: NotificationType.EMAIL_VERIFIED,
      subject: 'Email Verified',
      text: 'Hi {{user_name}}, your email has been verified successfully!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app'],
      variables: ['user_name'],
    },
    [NotificationType.PASSWORD_CHANGED]: {
      type: NotificationType.PASSWORD_CHANGED,
      subject: 'Password Changed',
      text: 'Hi {{user_name}}, your password has been changed successfully.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name'],
    },

    // Bookings
    [NotificationType.BOOKING_CREATED]: {
      type: NotificationType.BOOKING_CREATED,
      subject: 'Booking Created - {{coach_name}}',
      text: 'Hi {{user_name}}, your booking with {{coach_name}} on {{date}} at {{time}} has been created. Awaiting confirmation.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'date', 'time'],
    },
    [NotificationType.BOOKING_CONFIRMED]: {
      type: NotificationType.BOOKING_CONFIRMED,
      subject: 'Booking Confirmed - {{coach_name}}',
      text: 'Hi {{user_name}}, your booking with {{coach_name}} on {{date}} at {{time}} has been confirmed!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'date', 'time'],
    },
    [NotificationType.BOOKING_CANCELLED]: {
      type: NotificationType.BOOKING_CANCELLED,
      subject: 'Booking Cancelled - {{coach_name}}',
      text: 'Hi {{user_name}}, your booking with {{coach_name}} on {{date}} has been cancelled.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'coach_name', 'date'],
    },
    [NotificationType.BOOKING_COMPLETED]: {
      type: NotificationType.BOOKING_COMPLETED,
      subject: 'Session Completed - {{coach_name}}',
      text: 'Hi {{user_name}}, your session with {{coach_name}} on {{date}} has been completed. Leave a review!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'date'],
    },
    [NotificationType.BOOKING_REMINDER_24H]: {
      type: NotificationType.BOOKING_REMINDER_24H,
      subject: 'Reminder: Session Tomorrow - {{coach_name}}',
      text: 'Hi {{user_name}}, reminder: you have a session with {{coach_name}} tomorrow at {{time}}.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push', 'sms'],
      variables: ['user_name', 'coach_name', 'time'],
    },
    [NotificationType.BOOKING_REMINDER_1H]: {
      type: NotificationType.BOOKING_REMINDER_1H,
      subject: 'Your Session Starts in 1 Hour',
      text: 'Hi {{user_name}}, your session with {{coach_name}} starts in 1 hour. Get ready!',
      priority: NotificationPriority.CRITICAL,
      channels: ['in_app', 'push', 'sms'],
      variables: ['user_name', 'coach_name'],
    },
    [NotificationType.BOOKING_RESCHEDULED]: {
      type: NotificationType.BOOKING_RESCHEDULED,
      subject: 'Booking Rescheduled - {{coach_name}}',
      text: 'Hi {{user_name}}, your booking with {{coach_name}} has been rescheduled to {{new_date}} at {{new_time}}.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'new_date', 'new_time'],
    },

    // Payments
    [NotificationType.PAYMENT_INITIATED]: {
      type: NotificationType.PAYMENT_INITIATED,
      subject: 'Payment Processing',
      text: 'Hi {{user_name}}, payment of {{amount}} {{currency}} initiated for {{description}}.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'amount', 'currency', 'description'],
    },
    [NotificationType.PAYMENT_SUCCESSFUL]: {
      type: NotificationType.PAYMENT_SUCCESSFUL,
      subject: 'Payment Successful',
      text: 'Hi {{user_name}}, payment of {{amount}} {{currency}} for {{description}} has been received successfully!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'amount', 'currency', 'description'],
    },
    [NotificationType.PAYMENT_FAILED]: {
      type: NotificationType.PAYMENT_FAILED,
      subject: 'Payment Failed',
      text: 'Hi {{user_name}}, payment failed for {{description}}. Reason: {{reason}}. Please try again.',
      priority: NotificationPriority.CRITICAL,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'description', 'reason'],
    },
    [NotificationType.PAYMENT_REFUNDED]: {
      type: NotificationType.PAYMENT_REFUNDED,
      subject: 'Payment Refunded',
      text: 'Hi {{user_name}}, refund of {{amount}} {{currency}} has been processed for {{reason}}.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'amount', 'currency', 'reason'],
    },
    [NotificationType.SUBSCRIPTION_STARTED]: {
      type: NotificationType.SUBSCRIPTION_STARTED,
      subject: 'Subscription Active',
      text: 'Hi {{user_name}}, your {{plan_name}} subscription is now active until {{expiry_date}}.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'plan_name', 'expiry_date'],
    },
    [NotificationType.SUBSCRIPTION_RENEWED]: {
      type: NotificationType.SUBSCRIPTION_RENEWED,
      subject: 'Subscription Renewed',
      text: 'Hi {{user_name}}, your {{plan_name}} subscription has been auto-renewed until {{expiry_date}}.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'plan_name', 'expiry_date'],
    },
    [NotificationType.SUBSCRIPTION_EXPIRING_SOON]: {
      type: NotificationType.SUBSCRIPTION_EXPIRING_SOON,
      subject: 'Subscription Expiring Soon',
      text: 'Hi {{user_name}}, your {{plan_name}} subscription expires on {{expiry_date}}. Renew now to avoid interruption.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'plan_name', 'expiry_date'],
    },
    [NotificationType.SUBSCRIPTION_EXPIRED]: {
      type: NotificationType.SUBSCRIPTION_EXPIRED,
      subject: 'Subscription Expired',
      text: 'Hi {{user_name}}, your {{plan_name}} subscription has expired. Renew to continue enjoying premium features.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'plan_name'],
    },
    [NotificationType.INVOICE_GENERATED]: {
      type: NotificationType.INVOICE_GENERATED,
      subject: 'Invoice for {{description}}',
      text: 'Hi {{user_name}}, an invoice for {{description}} ({{amount}} {{currency}}) has been generated. You can view it in your account.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'description', 'amount', 'currency'],
    },

    // Reviews
    [NotificationType.REVIEW_RECEIVED]: {
      type: NotificationType.REVIEW_RECEIVED,
      subject: 'New Review from {{reviewer_name}}',
      text: 'Hi {{user_name}}, {{reviewer_name}} left a {{rating}}-star review for your coaching session.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'reviewer_name', 'rating'],
    },
    [NotificationType.REVIEW_PUBLISHED]: {
      type: NotificationType.REVIEW_PUBLISHED,
      subject: 'Review Published',
      text: 'Hi {{user_name}}, your review for {{coach_name}} has been published.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app'],
      variables: ['user_name', 'coach_name'],
    },
    [NotificationType.REVIEW_RATING_IMPROVED]: {
      type: NotificationType.REVIEW_RATING_IMPROVED,
      subject: 'Rating Improved - {{coach_name}}',
      text: 'Hi {{coach_name}}, congratulations! Your rating has improved to {{new_rating}} stars.',
      priority: NotificationPriority.LOW,
      channels: ['in_app', 'email'],
      variables: ['coach_name', 'new_rating'],
    },

    // Goals
    [NotificationType.GOAL_CREATED]: {
      type: NotificationType.GOAL_CREATED,
      subject: 'Goal Created - {{goal_title}}',
      text: 'Hi {{user_name}}, your goal "{{goal_title}}" has been created. Target date: {{target_date}}.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'goal_title', 'target_date'],
    },
    [NotificationType.GOAL_PROGRESS_25]: {
      type: NotificationType.GOAL_PROGRESS_25,
      subject: 'Goal Milestone: 25% Progress',
      text: 'Great work {{user_name}}! You are 25% towards completing "{{goal_title}}".',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push'],
      variables: ['user_name', 'goal_title'],
    },
    [NotificationType.GOAL_PROGRESS_50]: {
      type: NotificationType.GOAL_PROGRESS_50,
      subject: 'Goal Milestone: 50% Progress',
      text: 'Halfway there {{user_name}}! You are 50% towards completing "{{goal_title}}".',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'goal_title'],
    },
    [NotificationType.GOAL_PROGRESS_75]: {
      type: NotificationType.GOAL_PROGRESS_75,
      subject: 'Goal Milestone: 75% Progress',
      text: 'Almost done {{user_name}}! You are 75% towards completing "{{goal_title}}".',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push'],
      variables: ['user_name', 'goal_title'],
    },
    [NotificationType.GOAL_COMPLETED]: {
      type: NotificationType.GOAL_COMPLETED,
      subject: 'Goal Completed! 🎉',
      text: 'Congratulations {{user_name}}! You have completed your goal "{{goal_title}}"!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'goal_title'],
    },
    [NotificationType.GOAL_DEADLINE_APPROACHING]: {
      type: NotificationType.GOAL_DEADLINE_APPROACHING,
      subject: 'Goal Deadline Approaching',
      text: 'Hi {{user_name}}, the deadline for "{{goal_title}}" is {{days_remaining}} days away. Keep pushing!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push', 'sms'],
      variables: ['user_name', 'goal_title', 'days_remaining'],
    },
    [NotificationType.GOAL_COACH_ASSIGNED]: {
      type: NotificationType.GOAL_COACH_ASSIGNED,
      subject: 'Coach Assigned to Your Goal',
      text: 'Hi {{user_name}}, {{coach_name}} has been assigned as your coach for goal "{{goal_title}}".',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'coach_name', 'goal_title'],
    },
    [NotificationType.COACH_NOTE_ADDED]: {
      type: NotificationType.COACH_NOTE_ADDED,
      subject: 'Coach Note - {{coach_name}}',
      text: 'Hi {{user_name}}, {{coach_name}} added a note to your goal "{{goal_title}}": {{note_preview}}',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'goal_title', 'note_preview'],
    },

    // Coach Profile
    [NotificationType.COACH_PROFILE_VERIFIED]: {
      type: NotificationType.COACH_PROFILE_VERIFIED,
      subject: 'Coach Profile Verified ✓',
      text: 'Congratulations {{coach_name}}, your coach profile has been verified! You can now accept bookings.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['coach_name'],
    },
    [NotificationType.COACH_PROFILE_REJECTION]: {
      type: NotificationType.COACH_PROFILE_REJECTION,
      subject: 'Coach Profile Review',
      text: 'Hi {{coach_name}}, your coach profile verification was not approved. Reason: {{reason}}. Please resubmit.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['coach_name', 'reason'],
    },
    [NotificationType.COACH_REGISTRATION_FEE_PAID]: {
      type: NotificationType.COACH_REGISTRATION_FEE_PAID,
      subject: 'Registration Fee Received',
      text: 'Hi {{coach_name}}, your registration fee of {{amount}} {{currency}} has been received. Welcome!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['coach_name', 'amount', 'currency'],
    },

    // Video Community
    [NotificationType.VIDEO_UPLOADED]: {
      type: NotificationType.VIDEO_UPLOADED,
      subject: 'Video Upload Received',
      text: 'Hi {{user_name}}, your video "{{video_title}}" has been uploaded and is pending review.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'video_title'],
    },
    [NotificationType.VIDEO_PUBLISHED]: {
      type: NotificationType.VIDEO_PUBLISHED,
      subject: 'Video Published',
      text: 'Hi {{user_name}}, your video "{{video_title}}" has been published and is now live!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'video_title'],
    },
    [NotificationType.VIDEO_COMMENT]: {
      type: NotificationType.VIDEO_COMMENT,
      subject: 'New Comment on {{video_title}}',
      text: 'Hi {{user_name}}, {{commenter_name}} commented on your video: "{{comment_preview}}"',
      priority: NotificationPriority.LOW,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'video_title', 'commenter_name', 'comment_preview'],
    },

    // Chat
    [NotificationType.MESSAGE_RECEIVED]: {
      type: NotificationType.MESSAGE_RECEIVED,
      subject: 'New Message from {{sender_name}}',
      text: 'Hi {{user_name}}, you have a new message from {{sender_name}}: {{message_preview}}',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'push', 'sms'],
      variables: ['user_name', 'sender_name', 'message_preview'],
    },
    [NotificationType.MESSAGE_REQUEST]: {
      type: NotificationType.MESSAGE_REQUEST,
      subject: 'Message Request from {{sender_name}}',
      text: 'Hi {{user_name}}, {{sender_name}} wants to send you a message.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push'],
      variables: ['user_name', 'sender_name'],
    },

    // Badges
    [NotificationType.BADGE_EARNED]: {
      type: NotificationType.BADGE_EARNED,
      subject: 'Badge Earned! 🏆',
      text: 'Congratulations {{user_name}}, you earned the "{{badge_name}}" badge!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push'],
      variables: ['user_name', 'badge_name'],
    },
    [NotificationType.BADGE_MILESTONE]: {
      type: NotificationType.BADGE_MILESTONE,
      subject: 'Milestone Achievement',
      text: 'Amazing {{user_name}}, you have earned {{badge_count}} badges!',
      priority: NotificationPriority.LOW,
      channels: ['in_app'],
      variables: ['user_name', 'badge_count'],
    },

    // Custom Offers
    [NotificationType.CUSTOM_OFFER_RECEIVED]: {
      type: NotificationType.CUSTOM_OFFER_RECEIVED,
      subject: 'Custom Offer from {{coach_name}}',
      text: 'Hi {{user_name}}, {{coach_name}} sent you a custom offer for {{offer_details}}. Review and respond within 7 days.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name', 'offer_details'],
    },
    [NotificationType.CUSTOM_OFFER_ACCEPTED]: {
      type: NotificationType.CUSTOM_OFFER_ACCEPTED,
      subject: 'Custom Offer Accepted',
      text: 'Hi {{coach_name}}, {{user_name}} accepted your custom offer!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email', 'push'],
      variables: ['coach_name', 'user_name'],
    },
    [NotificationType.CUSTOM_OFFER_DECLINED]: {
      type: NotificationType.CUSTOM_OFFER_DECLINED,
      subject: 'Custom Offer Declined',
      text: 'Hi {{coach_name}}, {{user_name}} declined your custom offer. Better luck next time!',
      priority: NotificationPriority.LOW,
      channels: ['in_app'],
      variables: ['coach_name', 'user_name'],
    },

    // Sessions & Packages
    [NotificationType.SESSION_PACKAGE_PURCHASED]: {
      type: NotificationType.SESSION_PACKAGE_PURCHASED,
      subject: 'Session Package Purchased',
      text: 'Hi {{user_name}}, you have purchased {{session_count}} sessions with {{coach_name}}. Valid until {{expiry_date}}.',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'session_count', 'coach_name', 'expiry_date'],
    },
    [NotificationType.SESSION_COMPLETED]: {
      type: NotificationType.SESSION_COMPLETED,
      subject: 'Session Completed',
      text: 'Hi {{user_name}}, your coaching session with {{coach_name}} is complete. {{remaining_sessions}} sessions remaining.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'push'],
      variables: ['user_name', 'coach_name', 'remaining_sessions'],
    },
    [NotificationType.SESSIONS_REMAINING_5]: {
      type: NotificationType.SESSIONS_REMAINING_5,
      subject: 'Only 5 Sessions Remaining',
      text: 'Hi {{user_name}}, you have only 5 sessions remaining with {{coach_name}}. Renew your package soon!',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email', 'push'],
      variables: ['user_name', 'coach_name'],
    },
    [NotificationType.SESSIONS_EXPIRED]: {
      type: NotificationType.SESSIONS_EXPIRED,
      subject: 'Sessions Expired',
      text: 'Hi {{user_name}}, your session package with {{coach_name}} has expired. Purchase again to continue!',
      priority: NotificationPriority.HIGH,
      channels: ['in_app', 'email'],
      variables: ['user_name', 'coach_name'],
    },

    // Admin
    [NotificationType.NEW_COACH_APPLICATION]: {
      type: NotificationType.NEW_COACH_APPLICATION,
      subject: 'New Coach Application',
      text: 'Admin Alert: {{coach_name}} has applied to be a coach. Review their application in the admin panel.',
      priority: NotificationPriority.CRITICAL,
      channels: ['in_app', 'email'],
      variables: ['coach_name'],
    },
    [NotificationType.CONTACT_FORM_SUBMITTED]: {
      type: NotificationType.CONTACT_FORM_SUBMITTED,
      subject: 'New Contact Form Submission',
      text: 'Admin Alert: {{sender_name}} submitted a contact form with subject "{{subject}}".  Review in admin panel.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['sender_name', 'subject'],
    },
    [NotificationType.ACCOUNT_UPDATED]: {
      type: NotificationType.ACCOUNT_UPDATED,
      subject: 'Account Updated',
      text: 'Hi {{user_name}}, your account has been updated. If this was not you, please contact support.',
      priority: NotificationPriority.MEDIUM,
      channels: ['in_app', 'email'],
      variables: ['user_name'],
    },
  };

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * Send a notification
   * @param options Notification options
   */
  async sendNotification(options: {
    type: NotificationType;
    recipient_id: string;
    sender_id?: string;
    entity_id?: string;
    variables?: Record<string, any>;
  }) {
    try {
      const { type, recipient_id, sender_id, entity_id, variables = {} } =
        options;

      // Get template
      const template = NOTIFICATION_TEMPLATES[type];
      if (!template) {
        this.logger.warn(`No template found for notification type: ${type}`);
        return null;
      }

      // Replace variables in text and subject
      let text = template.text;
      let subject = template.subject || '';
      for (const [key, value] of Object.entries(variables)) {
        text = text.replace(`{{${key}}}`, String(value));
        subject = subject.replace(`{{${key}}}`, String(value));
      }

      // Create notification event
      const notificationEvent = await this.prisma.notificationEvent.create({
        data: {
          type,
          text,
          status: 1,
        },
      });

      // Create notification
      const notification = await this.prisma.notification.create({
        data: {
          notification_event_id: notificationEvent.id,
          sender_id,
          receiver_id: recipient_id,
          entity_id,
          status: 1,
        },
      });

      this.logger.log(
        `Notification sent: ${type} to ${recipient_id} (ID: ${notification.id})`,
      );

      // Send via configured channels
      this.sendViaChannels(template, recipient_id, subject, text, variables).catch(
        (error) => {
          this.logger.warn(
            `Error sending notification via channels: ${error.message}`,
          );
        },
      );

      return notification;
    } catch (error) {
      this.logger.error(`Error sending notification (${options.type}):`, error);
      // Don't throw - notifications should not break business logic
      return null;
    }
  }

  /**
   * Send notification via configured channels
   */
  private async sendViaChannels(
    template: NotificationTemplate,
    recipient_id: string,
    subject: string,
    text: string,
    variables: Record<string, any>,
  ) {
    // Get recipient user for email
    const user = await this.prisma.user.findUnique({
      where: { id: recipient_id },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      this.logger.warn(`User not found: ${recipient_id}`);
      return;
    }

    // Send via email if channel is enabled
    if (template.channels.includes('email') && user.email) {
      try {
        await this.mailService.sendNotification({
          to: user.email,
          subject: subject,
          template: 'notification.ejs',
          context: {
            name: user.name || 'User',
            subject: subject,
            text: text,
          },
        });
        this.logger.log(`Email sent to ${user.email} for ${template.type}`);
      } catch (error) {
        this.logger.error(
          `Failed to send email to ${user.email}: ${error.message}`,
        );
      }
    }

    // Push notifications via Socket.IO would go here
    // if (template.channels.includes('push')) {
    //   this.sendPushNotificationViaSocket(recipient_id, subject, text);
    // }

    // SMS notifications would go here
    // if (template.channels.includes('sms')) {
    //   this.sendSmsNotification(user.phone, text);
    // }
  }

  /**
   * Send notifications to multiple recipients
   */
  async sendNotificationToMultiple(options: {
    type: NotificationType;
    recipient_ids: string[];
    sender_id?: string;
    entity_id?: string;
    variables?: Record<string, any>;
  }) {
    const { recipient_ids, ...rest } = options;
    const results = await Promise.allSettled(
      recipient_ids.map((id) =>
        this.sendNotification({ ...rest, recipient_id: id }),
      ),
    );

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    this.logger.log(
      `Batch notification: ${successful}/${recipient_ids.length} sent for type ${options.type}`,
    );

    return results;
  }

  /**
   * Get template for a notification type
   */
  getTemplate(type: NotificationType): NotificationTemplate | null {
    return NOTIFICATION_TEMPLATES[type] || null;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId?: string) {
    if (userId) {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, receiver_id: userId, deleted_at: null },
      });
      if (!existing) {
        throw new NotFoundException('Notification not found');
      }
    }

    return await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read_at: new Date() },
    });
  }

  /**
   * Get unread notifications for a user
   */
  async getUnreadNotifications(
    userId: string,
    limit = 10,
    offset = 0,
  ) {
    return await this.prisma.notification.findMany({
      where: {
        receiver_id: userId,
        read_at: null,
        deleted_at: null,
      },
      include: { notification_event: true, sender: { select: { id: true, name: true, avatar: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Get all notifications for a user
   */
  async getAllNotifications(userId: string, limit = 20, offset = 0) {
    return await this.prisma.notification.findMany({
      where: {
        receiver_id: userId,
        deleted_at: null,
      },
      include: { notification_event: true, sender: { select: { id: true, name: true, avatar: true } } },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId: string, userId?: string) {
    if (userId) {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, receiver_id: userId, deleted_at: null },
      });
      if (!existing) {
        throw new NotFoundException('Notification not found');
      }
    }

    return await this.prisma.notification.update({
      where: { id: notificationId },
      data: { deleted_at: new Date() },
    });
  }

  /**
   * Clear all notifications for a user
   */
  async clearAllNotifications(userId: string) {
    return await this.prisma.notification.updateMany({
      where: { receiver_id: userId, deleted_at: null },
      data: { deleted_at: new Date() },
    });
  }
}
