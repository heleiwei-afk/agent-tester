'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useState } from 'react';

interface PaginationControlProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

/**
 * 通用分页组件
 * 显示：首页 / 上一页 / 页码列表 / 下一页 / 末页 / 跳转 / 总条数
 */
export function PaginationControl({
  page,
  totalPages,
  total,
  onPageChange,
}: PaginationControlProps) {
  const [jumpValue, setJumpValue] = useState('');

  if (totalPages <= 1) return null;

  const handleJump = () => {
    const target = parseInt(jumpValue);
    if (target >= 1 && target <= totalPages) {
      onPageChange(target);
      setJumpValue('');
    }
  };

  // 生成页码列表（最多显示 7 个页码）
  const getPageNumbers = (): (number | '...')[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages: (number | '...')[] = [];

    if (page <= 4) {
      // 靠近开头
      pages.push(1, 2, 3, 4, 5, '...', totalPages);
    } else if (page >= totalPages - 3) {
      // 靠近结尾
      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
    } else {
      // 中间
      pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
    }

    return pages;
  };

  return (
    <div className="flex items-center justify-between px-2 py-3">
      <span className="text-sm text-muted-foreground">
        共 {total} 条
      </span>

      <div className="flex items-center gap-1">
        {/* 首页 */}
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
        >
          <ChevronsLeft className="size-3.5" />
        </Button>

        {/* 上一页 */}
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
        >
          <ChevronLeft className="size-3.5" />
        </Button>

        {/* 页码列表 */}
        {getPageNumbers().map((p, idx) =>
          p === '...' ? (
            <span key={`ellipsis-${idx}`} className="px-1 text-sm text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="icon-xs"
              onClick={() => onPageChange(p)}
            >
              {p}
            </Button>
          )
        )}

        {/* 下一页 */}
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
        >
          <ChevronRight className="size-3.5" />
        </Button>

        {/* 末页 */}
        <Button
          variant="outline"
          size="icon-xs"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
        >
          <ChevronsRight className="size-3.5" />
        </Button>

        {/* 跳转 */}
        <div className="flex items-center gap-1 ml-2">
          <span className="text-sm text-muted-foreground">跳至</span>
          <Input
            className="w-12 h-6 text-xs text-center"
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJump()}
            placeholder={String(page)}
          />
          <span className="text-sm text-muted-foreground">页</span>
        </div>
      </div>
    </div>
  );
}
