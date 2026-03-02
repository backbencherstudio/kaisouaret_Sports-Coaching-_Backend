import * as PDFDocument from 'pdfkit';
import dayjs = require('dayjs');

export class PDFGenerator {
  /**
   * Generate User Activity Report PDF
   */
  static generateUserActivityPDF(reportData: any): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    this.addHeader(doc, reportData.report_name);
    this.addReportMeta(doc, reportData);

    // Summary
    doc.font('Helvetica-Bold').fontSize(12).text(`Total Records: ${reportData.total_records}`);
    doc.font('Helvetica').moveDown(1);

    // Table Header
    const tableTop = doc.y;
    this.addTableHeaders(doc, ['Name', 'Email', 'Type', 'Status', 'Bookings', 'Joined'], tableTop);

    // Table Data
    let yPosition = tableTop + 25;
    reportData.data.forEach((record: any, index: number) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
        this.addTableHeaders(doc, ['Name', 'Email', 'Type', 'Status', 'Bookings', 'Joined'], yPosition);
        yPosition += 25;
      }

      doc.fontSize(9)
        .text(this.truncate(record.name, 20), 50, yPosition, { width: 100 })
        .text(this.truncate(record.email, 25), 150, yPosition, { width: 130 })
        .text(record.type, 280, yPosition, { width: 50 })
        .text(record.status, 330, yPosition, { width: 60 })
        .text(record.total_bookings.toString(), 390, yPosition, { width: 50 })
        .text(record.joined_date, 440, yPosition, { width: 80 });

      yPosition += 20;
    });

    // Footer
    this.addFooter(doc);

    return doc;
  }

  /**
   * Generate Revenue Report PDF
   */
  static generateRevenuePDF(reportData: any): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    this.addHeader(doc, reportData.report_name);
    this.addReportMeta(doc, reportData);

    // Summary
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#2563eb')
      .text(`Total Revenue: $${reportData.total_revenue.toLocaleString()}`);
    doc.fillColor('#000000').font('Helvetica');
    doc.fontSize(10).text(`Total Transactions: ${reportData.total_records}`);
    doc.moveDown(1);

    // Table Header
    const tableTop = doc.y;
    this.addTableHeaders(doc, ['Transaction ID', 'User', 'Amount', 'Status', 'Date'], tableTop);

    // Table Data
    let yPosition = tableTop + 25;
    reportData.data.forEach((record: any) => {
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
        this.addTableHeaders(doc, ['Transaction ID', 'User', 'Amount', 'Status', 'Date'], yPosition);
        yPosition += 25;
      }

      doc.fontSize(9)
        .text(this.truncate(record.transaction_id, 15), 50, yPosition, { width: 100 })
        .text(this.truncate(record.user_name, 20), 150, yPosition, { width: 120 })
        .text(`$${record.amount}`, 270, yPosition, { width: 70 })
        .text(record.status, 340, yPosition, { width: 80 })
        .text(record.date, 420, yPosition, { width: 100 });

      yPosition += 20;
    });

    // Footer
    this.addFooter(doc);

    return doc;
  }

  /**
   * Generate Session Statistics PDF
   */
  static generateSessionStatisticsPDF(reportData: any): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });

    // Header
    this.addHeader(doc, reportData.report_name);
    this.addReportMeta(doc, reportData);

    // Status Breakdown
    doc.font('Helvetica-Bold').fontSize(12).text('Status Breakdown:');
    doc.font('Helvetica').fontSize(10)
      .text(`Total: ${reportData.status_breakdown.total}`)
      .text(`Completed: ${reportData.status_breakdown.completed}`)
      .text(`Confirmed: ${reportData.status_breakdown.confirmed}`)
      .text(`Pending: ${reportData.status_breakdown.pending}`)
      .text(`Cancelled: ${reportData.status_breakdown.cancelled}`);
    doc.moveDown(1);

    // Table Header
    const tableTop = doc.y;
    this.addTableHeaders(
      doc,
      ['Booking ID', 'Title', 'Athlete', 'Coach', 'Specialty', 'Status', 'Price', 'Date'],
      tableTop,
      true
    );

    // Table Data
    let yPosition = tableTop + 25;
    reportData.data.forEach((record: any) => {
      if (yPosition > 500) {
        doc.addPage({ layout: 'landscape' });
        yPosition = 50;
        this.addTableHeaders(
          doc,
          ['Booking ID', 'Title', 'Athlete', 'Coach', 'Specialty', 'Status', 'Price', 'Date'],
          yPosition,
          true
        );
        yPosition += 25;
      }

      doc.fontSize(8)
        .text(this.truncate(record.booking_id, 12), 50, yPosition, { width: 80 })
        .text(this.truncate(record.title, 15), 130, yPosition, { width: 100 })
        .text(this.truncate(record.athlete, 15), 230, yPosition, { width: 90 })
        .text(this.truncate(record.coach, 15), 320, yPosition, { width: 90 })
        .text(this.truncate(record.specialty, 12), 410, yPosition, { width: 80 })
        .text(record.status, 490, yPosition, { width: 70 })
        .text(`$${record.price}`, 560, yPosition, { width: 60 })
        .text(record.appointment_date, 620, yPosition, { width: 80 });

      yPosition += 18;
    });

    // Footer
    this.addFooter(doc);

    return doc;
  }

  /**
   * Generate Coach Performance PDF
   */
  static generateCoachPerformancePDF(reportData: any): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });

    // Header
    this.addHeader(doc, reportData.report_name);
    this.addReportMeta(doc, reportData);

    // Summary
    doc.font('Helvetica-Bold').fontSize(12).text(`Total Coaches: ${reportData.total_coaches}`);
    doc.font('Helvetica').moveDown(1);

    // Table Header
    const tableTop = doc.y;
    this.addTableHeaders(
      doc,
      ['Coach Name', 'Email', 'Specialty', 'Rating', 'Sessions', 'Completed', 'Revenue'],
      tableTop,
      true
    );

    // Table Data
    let yPosition = tableTop + 25;
    reportData.data.forEach((record: any) => {
      if (yPosition > 500) {
        doc.addPage({ layout: 'landscape' });
        yPosition = 50;
        this.addTableHeaders(
          doc,
          ['Coach Name', 'Email', 'Specialty', 'Rating', 'Sessions', 'Completed', 'Revenue'],
          yPosition,
          true
        );
        yPosition += 25;
      }

      const rating = record.avg_rating ? `${record.avg_rating}⭐` : 'N/A';

      doc.fontSize(9)
        .text(this.truncate(record.name, 20), 50, yPosition, { width: 140 })
        .text(this.truncate(record.email, 25), 190, yPosition, { width: 160 })
        .text(this.truncate(record.specialty, 15), 350, yPosition, { width: 100 })
        .text(rating, 450, yPosition, { width: 60 })
        .text(record.sessions_in_period.toString(), 510, yPosition, { width: 60 })
        .text(record.completed_in_period.toString(), 570, yPosition, { width: 70 })
        .text(`$${record.revenue_in_period}`, 640, yPosition, { width: 80 });

      yPosition += 20;
    });

    // Footer
    this.addFooter(doc);

    return doc;
  }

  /**
   * Generate Comprehensive Analytics PDF
   */
  static generateAnalyticsPDF(reportData: any): PDFKit.PDFDocument {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    this.addHeader(doc, reportData.report_name);
    this.addReportMeta(doc, reportData);

    // Date Range
    doc.font('Helvetica-Oblique').fontSize(10).text(
      `Period: ${reportData.date_range.start} to ${reportData.date_range.end}`,
    );
    doc.font('Helvetica').moveDown(1.5);

    // Users Summary
    doc.fontSize(14).fillColor('#1e40af').text('User Metrics', { underline: true });
    doc.fillColor('#000000').fontSize(11)
      .text(`Total Users: ${reportData.summary.users.total}`)
      .text(`New Users (Period): ${reportData.summary.users.new_in_period}`);
    doc.moveDown(1);

    // Coaches Summary
    doc.fontSize(14).fillColor('#1e40af').text('Coach Metrics', { underline: true });
    doc.fillColor('#000000').fontSize(11)
      .text(`Total Coaches: ${reportData.summary.coaches.total}`)
      .text(`Active Coaches: ${reportData.summary.coaches.active}`);
    doc.moveDown(1);

    // Bookings Summary
    doc.fontSize(14).fillColor('#1e40af').text('Booking Metrics', { underline: true });
    doc.fillColor('#000000').fontSize(11)
      .text(`Total Bookings (Period): ${reportData.summary.bookings.total_in_period}`)
      .text(`Completed Sessions: ${reportData.summary.bookings.completed}`)
      .text(`Completion Rate: ${reportData.summary.bookings.completion_rate}`);
    doc.moveDown(1);

    // Revenue Summary
    doc.fontSize(14).fillColor('#1e40af').text('Revenue Metrics', { underline: true });
    doc.fillColor('#000000').fontSize(11)
      .text(`Total Revenue: $${reportData.summary.revenue.total.toLocaleString()}`)
      .text(`Average Session Price: $${reportData.summary.revenue.avg_session_price}`);
    doc.moveDown(2);

    // Footer
    this.addFooter(doc);

    return doc;
  }

  /**
   * Helper: Add Header
   */
  private static addHeader(doc: PDFKit.PDFDocument, title: string): void {
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#1e3a8a').text(title, { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#cbd5e1').lineWidth(2).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.fillColor('#000000').font('Helvetica');
    doc.moveDown(1);
  }

  /**
   * Helper: Add Report Metadata
   */
  private static addReportMeta(doc: PDFKit.PDFDocument, reportData: any): void {
    doc.font('Helvetica-Oblique').fontSize(10)
      .text(`Period: ${reportData.period.toUpperCase()}`)
      .text(`Generated: ${dayjs(reportData.generated_at).format('YYYY-MM-DD HH:mm:ss')}`);
    doc.font('Helvetica').moveDown(1.5);
  }

  /**
   * Helper: Add Table Headers
   */
  private static addTableHeaders(
    doc: PDFKit.PDFDocument,
    headers: string[],
    yPosition: number,
    landscape = false
  ): void {
    const spacing = landscape ? 700 / headers.length : 500 / headers.length;
    let xPosition = 50;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1e40af');
    headers.forEach((header) => {
      doc.text(header, xPosition, yPosition, { width: spacing });
      xPosition += spacing;
    });
    doc.fillColor('#000000').font('Helvetica');

    // Underline
    doc.strokeColor('#cbd5e1')
      .lineWidth(1)
      .moveTo(50, yPosition + 15)
      .lineTo(landscape ? 750 : 550, yPosition + 15)
      .stroke();
  }

  /**
   * Helper: Add Footer
   */
  private static addFooter(doc: PDFKit.PDFDocument): void {
    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      doc.fontSize(8)
        .fillColor('#6b7280')
        .text(
          `CoachMe Platform - Generated on ${dayjs().format('YYYY-MM-DD HH:mm')}`,
          50,
          doc.page.height - 50,
          { align: 'center' }
        );
      doc.text(`Page ${i + 1} of ${pageCount}`, 50, doc.page.height - 35, { align: 'center' });
    }
  }

  /**
   * Helper: Truncate long text
   */
  private static truncate(text: string, maxLength: number): string {
    if (!text) return 'N/A';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
  }
}
